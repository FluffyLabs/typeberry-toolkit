import * as bytes from "@typeberry/lib/bytes";
import * as codec from "@typeberry/lib/codec";
import * as numbers from "@typeberry/lib/numbers";
import { RefineParams, AccumulateParams, IsAuthorizedParams } from "./EntrypointSelector";

export function encodeRefineParams(params: RefineParams): Uint8Array {
  const refineDescriptor = codec.codec.object({
    core: codec.codec.varU32,
    index: codec.codec.varU32,
    id: codec.codec.varU32,
    payload: codec.codec.blob,
    package: codec.codec.blob,
  });

  const payload = params.payload
    ? bytes.BytesBlob.parseBlob(params.payload)
    : bytes.BytesBlob.blobFrom(new Uint8Array());
  const packageHash = bytes.BytesBlob.parseBlob(params.package);

  const data = {
    core: numbers.tryAsU32(parseInt(params.core, 10) || 0),
    index: numbers.tryAsU32(parseInt(params.index, 10) || 0),
    id: numbers.tryAsU32(parseInt(params.id, 10) || 0),
    payload,
    package: packageHash,
  };

  return codec.Encoder.encodeObject(refineDescriptor, data).raw;
}

export function encodeAccumulateParams(params: AccumulateParams): Uint8Array {
  const accumulateDescriptor = codec.codec.object({
    slot: codec.codec.varU32,
    id: codec.codec.varU32,
    results: codec.codec.varU32,
  });

  const data = {
    slot: numbers.tryAsU32(parseInt(params.slot, 10) || 0),
    id: numbers.tryAsU32(parseInt(params.id, 10) || 0),
    results: numbers.tryAsU32(parseInt(params.results, 10) || 0),
  };

  return codec.Encoder.encodeObject(accumulateDescriptor, data).raw;
}

export function encodeIsAuthorizedParams(params: IsAuthorizedParams): Uint8Array {
  const isAuthorizedDescriptor = codec.codec.object({
    core: codec.codec.u16,
  });

  const data = {
    core: numbers.tryAsU16(parseInt(params.core, 10) || 0),
  };

  return codec.Encoder.encodeObject(isAuthorizedDescriptor, data).raw;
}
