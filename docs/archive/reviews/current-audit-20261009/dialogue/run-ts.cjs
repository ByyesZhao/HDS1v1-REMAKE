// Local TypeScript loader for the audit; avoids the esbuild child process blocked by this sandbox.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = function(module, filename) {
  const text = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  module._compile(output.outputText, filename);
};
require(path.resolve(process.argv[2]));
