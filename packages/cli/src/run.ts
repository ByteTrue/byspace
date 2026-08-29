import { createCli } from "./cli.js";

export interface RunCliOptions {
  nodeArgv?: [string, string];
}

export function createCliParseArgv(input: {
  argv: string[];
  nodeArgv?: [string, string];
}): string[] {
  const nodeArgv = input.nodeArgv ?? ["byspace", "byspace"];
  const cliArgv = input.argv.length === 0 ? ["onboard"] : input.argv;
  return [...nodeArgv, ...cliArgv];
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const program = createCli();
  await program.parseAsync(
    createCliParseArgv({
      argv,
      nodeArgv: options.nodeArgv,
    }),
    { from: "node" },
  );
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}
