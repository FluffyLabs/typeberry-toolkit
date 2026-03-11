import { Loader } from "@/components/ProgramLoader/Loader.tsx";
import { useEffect, useState } from "react";
import * as bytes from "@typeberry/lib/bytes";
import { MemoryChunkItem, PageMapItem, RegistersArray } from "@/types/pvm.ts";
import { useNavigate } from "react-router";
import { useAppSelector } from "@/store/hooks.ts";
import { selectInitialState } from "@/store/debugger/debuggerSlice.ts";
import { bigUint64ArrayToRegistersArray, getAsChunks, getAsPageMap } from "@/lib/utils.ts";
import { programs } from "@/components/ProgramLoader/examplePrograms";
import { decodeSpiWithMetadata } from "@/utils/spi";
import { buildArtifactDownloadUrl } from "@/lib/artifact-url";
import { ProgramUploadFileOutput } from "@/components/ProgramLoader/types";

const ProgramLoader = () => {
  const initialState = useAppSelector(selectInitialState);
  const navigate = useNavigate();
  const pvmLoaded = useAppSelector((state) => state.debugger.pvmLoaded);
  const isLoadedFromUrl = useState(false);

  const [pendingProgram, setPendingProgram] = useState<ProgramUploadFileOutput | null>(null);

  useEffect(() => {
    const loadProgramFromUrl = async () => {
      // we wait for the pvm to be loaded first.
      if (!pvmLoaded) {
        return;
      }
      // but we never load from url twice
      if (isLoadedFromUrl[0]) {
        return;
      }

      isLoadedFromUrl[1](true);

      // Parse query params - they may be in window.location.search OR inside the hash
      // Hash-based routing: /#/load?artifact=... means params are in the hash
      const hashParams = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
      const searchParams = new URLSearchParams(window.location.search);

      // Helper to get param from either location (hash takes precedence)
      const getParam = (key: string): string | null => hashParams.get(key) ?? searchParams.get(key);

      // Helper to create ProgramUploadFileOutput from raw bytes
      const createProgramOutput = (
        rawProgram: Uint8Array,
        sourceName: string,
        flavour?: string | null,
      ): ProgramUploadFileOutput | null => {
        // If flavour is explicitly "jam", force SPI decoding
        if ((flavour ?? "").toLowerCase() === "jam") {
          const { code, memory, registers, metadata } = decodeSpiWithMetadata(rawProgram, new Uint8Array());
          const pageMap: PageMapItem[] = getAsPageMap(memory);
          const chunks: MemoryChunkItem[] = getAsChunks(memory);

          return {
            program: Array.from(code),
            name: `${sourceName} [SPI]`,
            spiProgram: {
              program: rawProgram,
              hasMetadata: metadata !== undefined,
            },
            kind: "JAM SPI",
            initial: {
              regs: bigUint64ArrayToRegistersArray(registers),
              pc: 0,
              pageMap,
              memory: chunks,
              gas: 100_000_000_000n, // 100 billion gas for SPI programs
            },
          };
        }

        // Auto-detect: try SPI first, then fall back to generic
        let spi = null;
        try {
          spi = decodeSpiWithMetadata(rawProgram, new Uint8Array());
        } catch {
          // Not an SPI blob, will try generic
        }

        if (spi !== null) {
          const { code, memory, registers, metadata } = spi;
          const pageMap: PageMapItem[] = getAsPageMap(memory);
          const chunks: MemoryChunkItem[] = getAsChunks(memory);

          return {
            program: Array.from(code),
            name: `${sourceName} [SPI]`,
            spiProgram: {
              program: rawProgram,
              hasMetadata: metadata !== undefined,
            },
            kind: "JAM SPI",
            initial: {
              regs: bigUint64ArrayToRegistersArray(registers),
              pc: 0,
              pageMap,
              memory: chunks,
              gas: 100_000_000_000n, // 100 billion gas for SPI programs
            },
          };
        }

        // Fall back to generic PVM
        return {
          program: Array.from(rawProgram),
          name: `${sourceName} [generic]`,
          initial: initialState,
          kind: "Generic PVM",
          spiProgram: null,
        };
      };

      const example = getParam("example");
      if (example) {
        const program = programs[example];
        if (!program) {
          console.warn("Unknown example", example);
          navigate("/load", { replace: true });
          return;
        }

        // Examples are loaded directly without entrypoint selection
        const output: ProgramUploadFileOutput = {
          program: program.program,
          name: program.name,
          spiProgram: null,
          kind: "Example",
          initial: {
            regs: program.regs.map((x) => BigInt(x)) as RegistersArray,
            pc: program.pc,
            pageMap: program.pageMap,
            memory: program.memory,
            gas: program.gas,
          },
          exampleName: example,
        };
        setPendingProgram(output);
        return;
      }

      const artifact = getParam("artifact");
      if (artifact) {
        try {
          const artifactUrl = buildArtifactDownloadUrl(
            artifact,
            import.meta.env.VITE_ARTIFACTS_BASE_URL,
            window.location.origin,
          );

          const response = await fetch(artifactUrl);
          if (!response.ok) {
            throw new Error(`Failed to download artifact (${response.status})`);
          }

          const rawBytes = new Uint8Array(await response.arrayBuffer());
          const output = createProgramOutput(rawBytes, "loaded-from-artifact", getParam("flavour"));
          if (output) {
            setPendingProgram(output);
          } else {
            console.warn("Could not create program output from artifact");
            navigate("/load", { replace: true });
          }
          return;
        } catch (e) {
          console.warn("Could not load the artifact from URL", e);
          navigate("/load", { replace: true });
          return;
        }
      }

      const program = getParam("program");
      if (program) {
        try {
          // Add 0x prefix if it's not there - we're assuming it's the hex program either way
          const hexProgram = program?.startsWith("0x") ? program : `0x${program}`;
          const parsedBlob = bytes.BytesBlob.parseBlob(hexProgram ?? "").raw;
          const output = createProgramOutput(parsedBlob, "loaded-from-url", getParam("flavour"));
          if (output) {
            setPendingProgram(output);
          } else {
            console.warn("Could not create program output from URL");
            navigate("/load", { replace: true });
          }
        } catch (e) {
          console.warn("Could not parse the program from URL", e);
          navigate("/load", { replace: true });
        }
      }
    };

    loadProgramFromUrl();
  }, [pvmLoaded, isLoadedFromUrl, navigate, initialState]);

  return (
    <div className="w-full h-full flex flex-col items-center bg-accent dark:bg-background">
      <div className="sm:max-w-[70vw] sm:my-auto 2xl:my-[100px] sm:mr-[72px] max-sm:h-full sm:rounded-lg sm:border overflow-hidden">
        <Loader initialProgram={pendingProgram ?? undefined} />
      </div>
    </div>
  );
};

export default ProgramLoader;
