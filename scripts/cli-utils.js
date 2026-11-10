/**
 * Shared CLI plumbing for the maintenance scripts.
 *
 * Kept as CommonJS so both the `require`-style and `import`-style scripts can
 * use it without forcing either module convention on them.
 */

/**
 * Interpret a single argument.
 *
 * @returns {{key?: string, value?: unknown, positional?: string, consumed?: number}}
 */
function readArg(
  args,
  index,
  { value: valueFlags = {}, boolean: booleanFlags = {} },
) {
  const arg = args[index];
  const next = args[index + 1];

  if (Object.hasOwn(valueFlags, arg) && next) {
    return { key: valueFlags[arg], value: next, consumed: 1 };
  }
  if (Object.hasOwn(booleanFlags, arg)) {
    return { key: booleanFlags[arg], value: true, consumed: 0 };
  }
  if (!arg.startsWith("-")) {
    return { positional: arg, consumed: 0 };
  }
  return { consumed: 0 };
}

/**
 * Parse CLI arguments from a declaration of value and boolean flags.
 *
 * @param {string[]} args - Raw arguments (usually process.argv.slice(2))
 * @param {{value?: Record<string, string>, boolean?: Record<string, string>}} spec
 *   `value` maps a flag to the result key it assigns the following argument to;
 *   `boolean` maps a flag to the result key it sets to true.
 * @returns {Record<string, unknown> & {positionals: string[]}}
 */
function parseArgv(args, spec = {}) {
  const parsed = { positionals: [] };

  for (let i = 0; i < args.length; i++) {
    const arg = readArg(args, i, spec);
    if (arg.key !== undefined) parsed[arg.key] = arg.value;
    if (arg.positional !== undefined) parsed.positionals.push(arg.positional);
    i += arg.consumed ?? 0;
  }

  return parsed;
}

/** True when the caller asked for help or supplied no arguments at all. */
const wantsHelp = (args) =>
  args.length === 0 || args.includes("--help") || args.includes("-h");

/**
 * Run an async entry point, reporting a failure as a one-line error and
 * exiting with status 1.
 */
function runCli(main) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgv, wantsHelp, runCli };
