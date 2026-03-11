# PVM disassembler & debugger

- **Production @ https://pvm.fluffylabs.dev**
- Beta @ https://pvm-debugger.netlify.app/

## PVMs support

We have the following PVMs integrated by default.

- [x] [typeberry](https://github.com/fluffylabs/typeberry) - TypeScript implementation (Private)
- [x] [anan-as](https://github.com/tomusdrw/anan-as) - AssemblyScript implementation (as WASM)
- [x] [polkavm](https://github.com/paritytech/polkavm) - Rust implementation (as WASM)

There are few ways how you can add your own PVM to execute the code.

1. Upload WASM (supported interfaces: [wasm-bindgen](https://github.com/FluffyLabs/pvm-debugger/blob/main/src/packages/web-worker/wasmBindgenShell.ts#L4), [assembly script](https://github.com/FluffyLabs/pvm-debugger/blob/main/src/packages/web-worker/wasmAsShell.ts#L5), [Go](https://github.com/FluffyLabs/pvm-debugger/blob/main/src/packages/web-worker/wasmGoShell.ts#L5))
2. Point to an URL with metadata file (details in [#81](https://github.com/FluffyLabs/pvm-debugger/issues/81); example [pvm-metadata.json](https://github.com/tomusdrw/polkavm/blob/gh-pages/pvm-metadata.json))
3. Connect to WebSocket interface: [example & docs](https://github.com/wkwiatek/pvm-ws-rpc).

Details about the API requirements can be found in [#81](https://github.com/FluffyLabs/pvm-debugger/issues/81)

## Large Program Links (Artifacts)

For large binaries (too large for `?program=0x...` URL payloads), use the Cloudflare artifact worker in
[`workers/artifacts-worker`](./workers/artifacts-worker).

The debugger can load `?artifact=<id-or-url>` from `/load`. Set up your environment:

```bash
cp .env.example .env
```

This configures `VITE_ARTIFACTS_BASE_URL=https://pvm-artifacts.tomusdrw-cloudflare.workers.dev`.

Programmatic upload helper:

```bash
npm run artifact:upload -- \
  --file ./path/to/program.bin \
  --worker https://pvm-artifacts.tomusdrw-cloudflare.workers.dev \
  --debugger http://localhost:5173
```

This prints the returned `artifactId` and a ready-to-open debugger link:

```text
http://localhost:5173/#/load?artifact=<artifactId>
```

Upload and open the debugger automatically:

```bash
npm run artifact:upload:open -- \
  --file ./path/to/program.bin \
  --worker https://pvm-artifacts.tomusdrw-cloudflare.workers.dev \
  --debugger http://localhost:5173
```

## Development

### Requirements

```bash
$ node --version
v 22.1.0
```

We recommend [NVM](https://github.com/nvm-sh/nvm) to install and manage different
`node` versions.

### Installing dependencies

```bash
$ npm ci
```

### Start a development version

```bash
$ npm run dev
```

### Building

```bash
$ npm run build
```

The static files with the website can then be found in `./dist` folder.

You can display them for instance with `http-server`:

```bash
$ npx http-server -o
```

### Running formatting & linting

```bash
$ npm run lint
```
