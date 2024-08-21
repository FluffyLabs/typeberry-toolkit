import { ArgsDecoder } from "./args-decoder/args-decoder";
import { byteToOpCodeMap } from "./assemblify";
import { ProgramDecoder } from "./program-decoder/program-decoder";

export function disassemblify(rawProgram: Uint8Array) {
  const programDecoder = new ProgramDecoder(rawProgram);
  const code = programDecoder.getCode();
  const mask = programDecoder.getMask();
  const argsDecoder = new ArgsDecoder(code, mask);
  let i = 0;
  const printableProgram = [];

  while (i < code.length) {
    const currentInstruction = code[i];
    let args;

    try {
      args = argsDecoder.getArgs(i);
      i += args.noOfBytesToSkip ?? 0;
    } catch (e) {
      printableProgram.push({
        instructionCode: currentInstruction,
        ...byteToOpCodeMap[currentInstruction],
        error: "Cannot get arguments from args decoder",
      });
      return printableProgram;
    }

    const currentInstructionDebug = {
      instructionCode: currentInstruction,
      ...byteToOpCodeMap[currentInstruction],
      instructionBytes: code.slice(i - (args.noOfBytesToSkip ?? 0), i),
      args,
    };

    printableProgram.push(currentInstructionDebug);
  }

  return printableProgram;
}
