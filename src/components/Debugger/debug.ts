import { InitialState } from "@/types/pvm";
import { Pvm } from "../../../node_modules/typeberry/packages/pvm/pvm";
import { Status } from "../../../node_modules/typeberry/packages/pvm/status";

// The only files we need from PVM repo:
import { ProgramDecoder } from "../../pvm-packages/pvm/program-decoder/program-decoder";
import { ArgsDecoder } from "../../pvm-packages/pvm/args-decoder/args-decoder";
import { byteToOpCodeMap } from "../../pvm-packages/pvm/assemblify";

export const initPvm = (program: number[], initialState: InitialState) => {
  const pvm = new Pvm(new Uint8Array(program), initialState);

  return pvm;
};

export const runAllInstructions = (pvm: Pvm, program: number[]) => {
  const programPreviewResult = [];

  do {
    const result = nextInstruction(pvm, program);
    programPreviewResult.push(result);
  } while (pvm.nextStep() === Status.OK);

  return {
    programRunResult: {
      pc: pvm.getPC(),
      regs: Array.from(pvm.getRegisters()),
      gas: pvm.getGas(),
      pageMap: pvm.getMemory(),
      memory: pvm.getMemory(),
      status: pvm.getStatus(),
    },
    programPreviewResult,
  };
};

export const nextInstruction = (pvm: Pvm, program: number[]) => {
  const programDecoder = new ProgramDecoder(new Uint8Array(program));
  const code = programDecoder.getCode();
  const mask = programDecoder.getMask();
  const argsDecoder = new ArgsDecoder(code, mask);

  const currentInstruction = code[pvm.getPC()];

  let args;

  try {
    args = argsDecoder.getArgs(pvm.getPC()) as any;

    const currentInstructionDebug = {
      instructionCode: currentInstruction,
      ...byteToOpCodeMap[currentInstruction],
      args: {
        ...args,
        immediate: args.immediateDecoder?.getUnsigned(),
      },
    };
    return currentInstructionDebug;
  } catch (e) {
    // The last iteration goes here since there's no instruction to proces and we didn't check if there's a next operation
    return { instructionCode: currentInstruction, ...byteToOpCodeMap[currentInstruction], error: "Cannot get arguments from args decoder" };
    // newProgramPreviewResult.push({ instructionCode: currentInstruction, ...byteToOpCodeMap[currentInstruction], error: "Cannot get arguments from args decoder" });
  }
};
