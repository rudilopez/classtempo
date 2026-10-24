import { describe, expect, it } from 'vitest';
import { onnx } from '../../../../node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx';
import { prepareFloat32Model, STEMS_COMPUTE_REVISION } from './modelPrecision';

const tensorType = (elemType: number, dimensions: (number | string)[]): onnx.ITypeProto => ({
  tensorType: { elemType, shape: { dim: dimensions.map((dimension) => typeof dimension === 'string'
    ? { dimParam: dimension } : { dimValue: dimension }) } },
});
const ioShape = [2, 'num_splits', 512, 1024];
const castAttribute = (type: number): onnx.IAttributeProto[] => [{ name: 'to', type: 2, i: type }];
const transposeAttribute = (): onnx.IAttributeProto[] => [{ name: 'perm', type: 7, ints: [1, 0, 2, 3] }];

/** Small, deterministic protobuf fixture for adapter invariants. Real inference uses the pinned model probes. */
function fixture(): onnx.ModelProto {
  const halfBits = [0x0000, 0x8000, 0x3c00, 0xc000, 0x0001, 0x7bff];
  const initializer: onnx.ITensorProto[] = Array.from({ length: 60 }, (_, index) => {
    const dimensions = index === 0 ? [16, 2, 5, 5] : [6];
    const count = dimensions.reduce((product, dimension) => product * dimension, 1);
    const rawData = new Uint8Array(count * 2);
    const view = new DataView(rawData.buffer);
    for (let i = 0; i < count; i++) view.setUint16(i * 2, halfBits[i % halfBits.length]!, true);
    return { name: index === 0 ? 'conv.weight' : `weight_${index}`, dataType: 10, dims: dimensions, rawData };
  });
  for (const [index, value] of [1, -2, 2, 3].entries()) {
    const rawData = new Uint8Array(8);
    new DataView(rawData.buffer).setBigInt64(0, BigInt(value), true);
    initializer.push({ name: `slice_${index}`, dataType: 7, dims: [1], rawData });
  }
  const node: onnx.INodeProto[] = [];
  const append = (opType: string, attribute: onnx.IAttributeProto[] = [], last = false): void => {
    const input = node.length ? node[node.length - 1]!.output![0]! : 'x';
    node.push({ name: `node_${node.length}`, opType, input: [input], output: [last ? 'y' : `value_${node.length}`], attribute });
  };
  append('Cast', castAttribute(10));
  append('Transpose', transposeAttribute());
  append('Conv', [{ name: 'strides', type: 7, ints: [2, 2] }, { name: 'group', type: 2, i: 1 }]);
  node[2]!.input!.push('conv.weight');
  for (const [operator, count] of Object.entries({ Conv: 6, BatchNormalization: 11, Elu: 11, ConvTranspose: 6, Slice: 12, Concat: 5, Sigmoid: 1, Mul: 1 })) {
    for (let i = 0; i < count; i++) append(operator, operator === 'Elu' ? [{ name: 'alpha', type: 1, f: 1 }] : []);
  }
  append('Transpose', transposeAttribute());
  append('Cast', castAttribute(1), true);
  const valueInfo: onnx.IValueInfoProto[] = initializer.map((tensor) => ({ name: tensor.name,
    type: tensorType(tensor.dataType!, tensor.dims!.map(Number)) }));
  for (const n of node.slice(0, -1)) valueInfo.push({ name: n.output![0], type: tensorType(10, ioShape) });
  return onnx.ModelProto.create({
    irVersion: 10, opsetImport: [{ domain: '', version: 18 }],
    metadataProps: Object.entries({ model_type: 'spleeter', sample_rate: '44100', stems: '4', conv_activation: 'ELU', deconv_activation: 'ELU' })
      .map(([key, value]) => ({ key, value })),
    graph: { name: 'adapter-fixture', node, initializer, valueInfo,
      input: [{ name: 'x', type: tensorType(1, ioShape) }], output: [{ name: 'y', type: tensorType(1, ioShape) }] },
  });
}
const encode = (model: onnx.IModelProto): Uint8Array => onnx.ModelProto.encode(model).finish();
const convert = (model: onnx.IModelProto): onnx.ModelProto => onnx.ModelProto.decode(prepareFloat32Model(encode(model)));

describe('pinned Spleeter float32 compute adapter', () => {
  it('preserves every stored weight bit, including negative zero, subnormals and the largest finite half', () => {
    const source = fixture();
    const converted = convert(source);
    expect(STEMS_COMPUTE_REVISION).toBe('fp32-compute-v1');
    const before = source.graph!.initializer!;
    const after = converted.graph!.initializer!;
    expect(after).toHaveLength(64);
    for (let i = 0; i < before.length; i++) {
      expect(Array.from(after[i]!.rawData!)).toEqual(Array.from(before[i]!.rawData!));
      expect(after[i]!.dims!.map(Number)).toEqual(before[i]!.dims!.map(Number));
      expect(after[i]!.dataType).toBe(before[i]!.dataType);
      if (i >= 60) expect(after[i]!.name).toBe(before[i]!.name);
    }
  });

  it('expands weights through casts and removes half precision from all activation paths without changing stereo or attributes', () => {
    const source = fixture();
    const result = convert(source).graph!;
    expect(result.node).toHaveLength(118);
    expect(onnx.ValueInfoProto.encode(result.input![0]!).finish()).toEqual(onnx.ValueInfoProto.encode(source.graph!.input![0]!).finish());
    expect(onnx.ValueInfoProto.encode(result.output![0]!).finish()).toEqual(onnx.ValueInfoProto.encode(source.graph!.output![0]!).finish());
    const known = new Set(['x', ...result.initializer!.map((tensor) => tensor.name)]);
    for (const node of result.node!) {
      for (const input of node.input!) expect(known.has(input)).toBe(true);
      node.output!.forEach((output) => known.add(output));
    }
    for (let i = 0; i < 60; i++) {
      const cast = result.node![i]!;
      expect(cast.opType).toBe('Cast');
      expect(cast.input).toEqual([result.initializer![i]!.name]);
      expect(cast.output).toEqual([source.graph!.initializer![i]!.name]);
      expect(Number(cast.attribute![0]!.i)).toBe(1);
    }
    for (let i = 1; i < 58; i++) expect(onnx.NodeProto.encode(result.node![i + 60]!).finish())
      .toEqual(onnx.NodeProto.encode(source.graph!.node![i]!).finish());
    expect(Number(result.node![60]!.attribute![0]!.i)).toBe(1);
    expect(result.valueInfo!.filter((value) => value.type?.tensorType?.elemType === 1)).toHaveLength(117);
    expect(result.valueInfo!.filter((value) => value.type?.tensorType?.elemType === 7)).toHaveLength(4);
  });

  it('does not mutate verified source bytes and produces deterministic derived bytes', () => {
    const bytes = encode(fixture());
    const original = bytes.slice();
    expect(prepareFloat32Model(bytes)).toEqual(prepareFloat32Model(bytes));
    expect(bytes).toEqual(original);
  });

  it.each([
    ['stereo shape', (m: onnx.ModelProto) => { m.graph!.input![0]!.type!.tensorType!.shape!.dim![0]!.dimValue = 1; }],
    ['frame shape', (m: onnx.ModelProto) => { m.graph!.output![0]!.type!.tensorType!.shape!.dim![2]!.dimValue = 256; }],
    ['opset', (m: onnx.ModelProto) => { m.opsetImport[0]!.version = 19; }],
    ['new operator', (m: onnx.ModelProto) => { m.graph!.node![4]!.opType = 'Clip'; }],
    ['subgraph attribute', (m: onnx.ModelProto) => { m.graph!.node![4]!.attribute = [{ name: 'body', type: 5, g: {} }]; }],
    ['tensor attribute', (m: onnx.ModelProto) => { m.graph!.node![4]!.attribute = [{ name: 'value', type: 4, t: { dataType: 10 } }]; }],
    ['duplicate output', (m: onnx.ModelProto) => { m.graph!.node![4]!.output = m.graph!.node![3]!.output; }],
    ['dangling input', (m: onnx.ModelProto) => { m.graph!.node![4]!.input = ['missing']; }],
    ['generated-name collision', (m: onnx.ModelProto) => { m.graph!.initializer![1]!.name = '__classtempo_fp16_storage_0'; }],
    ['external weights', (m: onnx.ModelProto) => { m.graph!.initializer![0]!.externalData = [{ key: 'location', value: 'weights.bin' }]; }],
    ['truncated weights', (m: onnx.ModelProto) => { m.graph!.initializer![0]!.rawData = new Uint8Array(2); }],
    ['nonfinite weights', (m: onnx.ModelProto) => { m.graph!.initializer![0]!.rawData![1] = 0x7c; }],
    ['mixed activation types', (m: onnx.ModelProto) => { m.graph!.valueInfo![64]!.type!.tensorType!.elemType = 1; }],
  ])('rejects unsupported %s before running inference', (_name, change) => {
    const model = fixture();
    change(model);
    expect(() => convert(model)).toThrow('adapter must be reviewed');
  });

  it('rejects corrupted input and accidental double conversion', () => {
    expect(() => prepareFloat32Model(new Uint8Array([0xff, 0xff]))).toThrow('could not be read');
    expect(() => prepareFloat32Model(prepareFloat32Model(encode(fixture())))).toThrow('adapter must be reviewed');
  });
});
