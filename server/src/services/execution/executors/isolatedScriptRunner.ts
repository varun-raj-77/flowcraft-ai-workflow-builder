import { Worker, parentPort, workerData } from 'node:worker_threads';
import { byteLength } from 'node:buffer';
import { redactText } from '../../../utils/redact';
import type { ExecutionInputs } from '../templateEngine';

type ScriptKind = 'transform' | 'condition';
const MAX_SOURCE = 16_384;
const MAX_INPUT = 256 * 1024;
const MAX_OUTPUT = 256 * 1024;
const TIMEOUT = 2500;
const MAX_CONCURRENT = 4;
let concurrent = 0;

export class IsolatedScriptError extends Error {
  constructor(
    readonly code: 'SCRIPT_REJECTED' | 'SCRIPT_LIMIT_EXCEEDED' | 'SCRIPT_FAILED',
    message: string,
    readonly guestStack?: string,
  ) {
    super(redactText(message).slice(0, 500));
    this.name = 'IsolatedScriptError';
  }
}

/**
 * This function is serialized as code written by FlowCraft (NOT user source).
 * It runs in a separate Worker with an independent QuickJS WASM runtime and
 * no registered host callbacks, network functions, module loader or Node APIs
 * inside the guest. Worker threads alone are not a security boundary.
 */
function isolatedWorkerMain() {
  const { parentPort: port, workerData: job } = require('node:worker_threads');
  const report = (message: object) => port.postMessage(message);
  (async () => {
    const { newQuickJSWASMModuleFromVariant } = require(job.corePath);
    const imported = require(job.variantPath);
    const variant = imported.default ?? imported;
    const wasm = await newQuickJSWASMModuleFromVariant(variant);
    const runtime = wasm.newRuntime();
    runtime.setMemoryLimit(16 * 1024 * 1024);
    runtime.setMaxStackSize(256 * 1024);
    const deadline = Date.now() + 400;
    runtime.setInterruptHandler(() => Date.now() > deadline);
    const vm = runtime.newContext();
    try {
      const json = JSON.stringify(job.inputs);
      const literal = JSON.stringify(json);
      const body = job.kind === 'condition'
        ? 'return Boolean((' + job.code + '));'
        : job.code;
      const source = '(function() { "use strict";'
        + 'const payload=JSON.parse(' + literal + ');'
        + 'const input=payload.input,prev=payload.prev,nodes=payload.nodes;'
        + 'const fn=function(input,prev,nodes) { "use strict";\n'
        + body + '\n};'
        + 'return JSON.stringify(fn(input,prev,nodes)); })()';
      const result = vm.evalCode(source, 'flowcraft-' + job.kind + '.js');
      if (result.error) {
        try {
          const error = vm.dump(result.error);
          const message = error && typeof error === 'object' && typeof error.message === 'string'
            ? error.message : String(error);
          const stack = error && typeof error === 'object' && typeof error.stack === 'string'
            ? error.stack : undefined;
          report({ ok: false, message: message.slice(0, 500), stack: stack?.slice(0, 2000) });
        } finally {
          result.error.dispose();
        }
        return;
      }
      try {
        const serialized = vm.dump(result.value);
        if (serialized === undefined || serialized === null) report({ ok: true, value: null });
        else if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > job.maxOutput) {
          report({ ok: false, limit: true, message: 'Script result exceeds 256 KB.' });
        } else report({ ok: true, value: JSON.parse(serialized) });
      } finally {
        result.value.dispose();
      }
    } finally {
      vm.dispose();
      runtime.dispose();
    }
  })().catch(() => report({ ok: false, message: 'The isolated script runtime failed.' }));
}

const BOOTSTRAP = '(' + isolatedWorkerMain.toString() + ')()';

interface ScriptReply {
  ok?: boolean;
  value?: unknown;
  message?: string;
  stack?: string;
  limit?: boolean;
}

export async function executeIsolatedScript(
  kind: ScriptKind,
  code: string,
  inputs: ExecutionInputs,
): Promise<unknown> {
  if (byteLength(code, 'utf8') > MAX_SOURCE)
    throw new IsolatedScriptError('SCRIPT_LIMIT_EXCEEDED', 'Script source exceeds 16 KB.');
  let payload: string;
  try {
    payload = JSON.stringify(inputs);
  } catch {
    throw new IsolatedScriptError('SCRIPT_REJECTED', 'Script inputs must be JSON-compatible.');
  }
  if (!payload || byteLength(payload, 'utf8') > MAX_INPUT)
    throw new IsolatedScriptError('SCRIPT_LIMIT_EXCEEDED', 'Script inputs exceed 256 KB.');
  if (concurrent >= MAX_CONCURRENT)
    throw new IsolatedScriptError('SCRIPT_LIMIT_EXCEEDED', 'Isolated script execution is busy. Try again.');
  const corePath = require.resolve('quickjs-emscripten-core');
  const variantPath = require.resolve('@jitl/quickjs-wasmfile-release-sync');
  concurrent += 1;
  let worker: Worker;
  try {
    worker = new Worker(BOOTSTRAP, {
      eval: true,
      workerData: { kind, code, inputs: JSON.parse(payload), corePath, variantPath, maxOutput: MAX_OUTPUT },
      env: {},
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
  } catch {
    concurrent -= 1;
    throw new IsolatedScriptError('SCRIPT_FAILED', 'Could not start isolated script worker.');
  }
  try {
    return await new Promise<unknown>((resolve, reject) => {
      let complete = false;
      const done = (error?: IsolatedScriptError, value?: unknown) => {
        if (complete) return;
        complete = true;
        clearTimeout(watchdog);
        if (error) reject(error);
        else resolve(value);
      };
      const watchdog = setTimeout(() => {
        done(new IsolatedScriptError('SCRIPT_LIMIT_EXCEEDED', 'Script exceeded its execution deadline.'));
        void worker.terminate();
      }, TIMEOUT);
      worker.once('message', (reply: ScriptReply) => {
        if (!reply || reply.ok !== true) {
          done(new IsolatedScriptError(reply?.limit ? 'SCRIPT_LIMIT_EXCEEDED' : 'SCRIPT_FAILED',
            reply?.message ?? 'Script execution failed.', reply?.stack));
        } else done(undefined, reply.value);
        void worker.terminate();
      });
      worker.once('error', () => done(new IsolatedScriptError('SCRIPT_FAILED', 'Isolated script worker crashed.')));
      worker.once('exit', () => {
        if (!complete) done(new IsolatedScriptError('SCRIPT_FAILED', 'Isolated script worker exited prematurely.'));
      });
    });
  } finally {
    concurrent -= 1;
    void worker.terminate();
  }
}
