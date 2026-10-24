// Deliberately coupled to the schema shipped by pinned onnxruntime-web@1.30.0. The package does not export
// this parser publicly. Dependency upgrades must revalidate the graph adapter and actual-model probes.
import { onnx } from '../../../../node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx';

export { SEPARATION_COMPUTE_VERSION as STEMS_COMPUTE_REVISION } from './separationModel';
const FLOAT = 1;
const INT64 = 7;
const FLOAT16 = 10;
const STORAGE_PREFIX = '__classtempo_fp16_storage_';
const CAST_PREFIX = '__classtempo_expand_weight_';
const EXPECTED_OPERATORS: Record<string, number> = {
  Cast: 2, Transpose: 2, Conv: 7, BatchNormalization: 11, Elu: 11,
  ConvTranspose: 6, Slice: 12, Concat: 5, Sigmoid: 1, Mul: 1,
};

function requireContract(condition: unknown): asserts condition {
  if (!condition) throw new Error('The pinned stems graph changed. Its float32 adapter must be reviewed.');
}

function shape(value: onnx.IValueInfoProto): (number | string)[] {
  return value.type?.tensorType?.shape?.dim?.map((dimension) => dimension.dimParam || Number(dimension.dimValue)) ?? [];
}

function requireIo(value: onnx.IValueInfoProto | undefined, name: string): void {
  requireContract(value?.name === name && value.type?.tensorType?.elemType === FLOAT &&
    JSON.stringify(shape(value)) === JSON.stringify([2, 'num_splits', 512, 1024]));
}

/**
 * Prepare ONLY the four size/SHA-256-verified, pinned Spleeter graphs for WASM inference.
 * This is not an integrity check or a general ONNX converter; callers must verify the original artifact first.
 * Keep every FP16 weight bit on disk/in transit, cast weights once inside the graph, and use FP32 activations.
 * Stereo remains one learned two-channel input. No attenuation, clipping, re-training or window changes occur.
 */
export function prepareFloat32Model(bytes: Uint8Array): Uint8Array {
  let model: onnx.ModelProto;
  try { model = onnx.ModelProto.decode(bytes); }
  catch { throw new Error('The pinned stems graph could not be read.'); }
  const graph = model.graph;
  requireContract(graph && Number(model.irVersion) === 10 && model.opsetImport.length === 1 &&
    (model.opsetImport[0]?.domain ?? '') === '' && Number(model.opsetImport[0]?.version) === 18 &&
    model.functions.length === 0 && model.trainingInfo.length === 0);
  requireContract(graph.input?.length === 1 && graph.output?.length === 1 &&
    graph.node?.length === 58 && graph.initializer?.length === 64 && graph.valueInfo?.length === 121 &&
    !graph.sparseInitializer?.length && !graph.quantizationAnnotation?.length);
  requireIo(graph.input[0], 'x');
  requireIo(graph.output[0], 'y');
  const nodes = graph.node;
  const initializers = graph.initializer;
  const valueInfo = graph.valueInfo;
  const metadata = new Map(model.metadataProps.map((entry) => [entry.key, entry.value]));
  requireContract(metadata.get('model_type') === 'spleeter' && metadata.get('sample_rate') === '44100' &&
    metadata.get('stems') === '4' && metadata.get('conv_activation') === 'ELU' &&
    metadata.get('deconv_activation') === 'ELU');

  const names = new Set<string>();
  const reserve = (name: string | null | undefined): void => {
    requireContract(name && !names.has(name) && !name.startsWith(STORAGE_PREFIX) && !name.startsWith(CAST_PREFIX));
    names.add(name);
  };
  reserve('x');
  const initializerNames = new Set<string>();
  let halfWeights = 0;
  let integerWeights = 0;
  for (const tensor of initializers) {
    reserve(tensor.name);
    initializerNames.add(tensor.name!);
    requireContract(!tensor.externalData?.length && !tensor.dataLocation && tensor.rawData?.length &&
      !tensor.floatData?.length && !tensor.doubleData?.length && !tensor.int32Data?.length &&
      !tensor.int64Data?.length && !tensor.uint64Data?.length && !tensor.stringData?.length);
    const dimensions = tensor.dims?.map(Number) ?? [];
    const count = dimensions.reduce((product, dimension) => product * dimension, 1);
    requireContract(dimensions.length && dimensions.every((dimension) => Number.isSafeInteger(dimension) && dimension > 0) &&
      Number.isSafeInteger(count));
    if (tensor.dataType === FLOAT16) {
      halfWeights++;
      requireContract(tensor.rawData.length === count * 2);
      // Nonfinite constants must not be disguised as an activation precision problem.
      for (let i = 1; i < tensor.rawData.length; i += 2) requireContract((tensor.rawData[i]! & 0x7c) !== 0x7c);
    } else {
      integerWeights++;
      requireContract(tensor.dataType === INT64 && tensor.rawData.length === count * 8);
    }
  }
  requireContract(halfWeights === 60 && integerWeights === 4);
  const firstKernel = initializers.find((tensor) => tensor.name === 'conv.weight');
  requireContract(firstKernel && JSON.stringify(firstKernel.dims?.map(Number)) === '[16,2,5,5]');

  const counts: Record<string, number> = {};
  const nodeNames = new Set<string>();
  for (const node of nodes) {
    requireContract(node.name && !nodeNames.has(node.name) && !node.name.startsWith(CAST_PREFIX) &&
      (node.domain ?? '') === '' && node.opType && EXPECTED_OPERATORS[node.opType]);
    nodeNames.add(node.name);
    counts[node.opType] = (counts[node.opType] ?? 0) + 1;
    requireContract(node.input?.length && node.input.every((name) => names.has(name)) && node.output?.length === 1);
    reserve(node.output[0]);
    // These pinned graphs contain scalar/list operator attributes only, never subgraphs, tensors or types.
    for (const attribute of node.attribute ?? []) {
      requireContract([1, 2, 3, 6, 7, 8].includes(attribute.type ?? 0) && !attribute.t && !attribute.g &&
        !attribute.sparseTensor && !attribute.tp && !attribute.tensors?.length && !attribute.graphs?.length &&
        !attribute.sparseTensors?.length && !attribute.typeProtos?.length && !attribute.refAttrName);
    }
    if (node.opType === 'Transpose') {
      const attributes = node.attribute ?? [];
      requireContract(attributes.length === 1 && attributes[0]?.name === 'perm' &&
        JSON.stringify(attributes[0].ints?.map(Number)) === '[1,0,2,3]');
    }
  }
  requireContract(Object.entries(EXPECTED_OPERATORS).every(([operator, count]) => counts[operator] === count));
  const entry = nodes[0];
  const exit = nodes[nodes.length - 1];
  requireContract(entry?.opType === 'Cast' && entry.input?.[0] === 'x' && entry.attribute?.length === 1 &&
    entry.attribute[0]?.name === 'to' && Number(entry.attribute[0].i) === FLOAT16 &&
    exit?.opType === 'Cast' && exit.output?.[0] === 'y' && exit.attribute?.length === 1 &&
    exit.attribute[0]?.name === 'to' && Number(exit.attribute[0].i) === FLOAT);

  const declaredNames = new Set<string>();
  let halfValues = 0;
  let integerValues = 0;
  for (const value of valueInfo) {
    requireContract(value.name && names.has(value.name) && !declaredNames.has(value.name) && value.type?.tensorType &&
      !value.type.sequenceType && !value.type.mapType && !value.type.optionalType && !value.type.sparseTensorType);
    declaredNames.add(value.name);
    if (value.type.tensorType.elemType === FLOAT16) halfValues++;
    else { requireContract(value.type.tensorType.elemType === INT64 && initializerNames.has(value.name)); integerValues++; }
  }
  requireContract(halfValues === 117 && integerValues === 4 &&
    initializers.every((tensor) => declaredNames.has(tensor.name!)));

  const weightCasts: onnx.INodeProto[] = [];
  for (const tensor of initializers) {
    if (tensor.dataType !== FLOAT16) continue;
    const name = tensor.name!;
    tensor.name = `${STORAGE_PREFIX}${weightCasts.length}`;
    weightCasts.push({
      name: `${CAST_PREFIX}${weightCasts.length}`, opType: 'Cast', input: [tensor.name], output: [name],
      attribute: [{ name: 'to', type: onnx.AttributeProto.AttributeType.INT, i: FLOAT }],
    });
  }
  for (const value of valueInfo) {
    if (value.type?.tensorType?.elemType === FLOAT16) value.type.tensorType.elemType = FLOAT;
  }
  entry.attribute[0].i = FLOAT;
  graph.node = [...weightCasts, ...nodes];
  return onnx.ModelProto.encode(model).finish();
}
