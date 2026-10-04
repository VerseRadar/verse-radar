// The Worker runtime provides this module; Node's lightweight regression harness does not.
export async function importWorker(source) {
  const localSource = source.replace('import { DurableObject } from "cloudflare:workers";',
    'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }');
  return import(`data:text/javascript;base64,${Buffer.from(localSource).toString("base64")}`);
}
