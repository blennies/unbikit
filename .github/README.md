# unbikit

[![minzipped bundle size](https://img.shields.io/bundlephobia/minzip/unbikit?style=flat-square)](https://bundlephobia.com/package/unbikit)
[![NPM Version](https://img.shields.io/npm/v/unbikit?style=flat-square)](https://www.npmjs.com/package/unbikit)
[![dependency count](https://img.shields.io/badge/dependency%20count-0-blue?style=flat-square)](https://npmgraph.js.org/?q=unbikit)
[![types included](https://img.shields.io/npm/types/unbikit?style=flat-square)](https://www.npmjs.com/package/unbikit)
[![license](https://img.shields.io/npm/l/unbikit?style=flat-square&color=0088cc)](/unbikit/license)
<br>
![isomorphic package badge](https://img.shields.io/badge/isomorphic-ECDC5A.svg?style=for-the-badge)
![Rolldown](https://img.shields.io/badge/rolldown-FF7E17?style=for-the-badge&logo=rolldown&logoColor=white)
![TypeScript badge](https://img.shields.io/badge/typescript-007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
[![PNPM badge](https://img.shields.io/badge/pnpm-4a4a4a.svg?style=for-the-badge&logo=pnpm&logoColor=f69220)](https://pnpm.io)
[![Conventional Commits badge](https://img.shields.io/badge/Conventional%20Commits-1.0.0-FE5196?style=for-the-badge&logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org)

## Introduction

<img src="/app/src/images/unbikit-logo.svg" alt="logo of unbikit" width="24" height="24"> unbikit
(_un-bik-ɪt_) is a decoder for `.bik` ([Bink Video](https://en.wikipedia.org/wiki/Bink_Video))
files that can be used to play or transcode videos. The format was first released in 1999 and has
since been used in many classic computer games.

⭐ [Documentation](https://blennies.github.io/unbikit/) and a
⭐ [video player demo](https://blennies.github.io/unbikit/demo/) are available!

### Features

- Supports Bink 1, revisions `c` to `i` inclusive
- Handles demuxing and decompression of audio and video streams
- TypeScript/JavaScript (no WASM or native code)
- No dependencies
- Straightforward API: supply a video via `Blob`, `File`, `Request` or `URL`
  - the Web Streams API will be used where possible for efficient reading of video data
- Isomorphic
  - runs on client/server runtimes that support at least ES2022
  - can be run with older runtimes by using the syntax lowering feature of some bundlers

## Getting started

To install the decoder:

```sh
npm install unbikit
```

To use it:

```typescript
import { createBikDecoder, type BikFrame } from "unbikit";
// or for CommonJS:
//   const { createBikDecoder } = require("unbikit");

const decoder = await createBikDecoder(new URL("/some/source/of/video.bik"));
let frame: BikFrame | null;
while ((frame = await decoder?.getNextFrame())) {
  // ... process frame
}
```

**_TODO: Add more installation instructions and more detailed usage instructions/examples_**

## Development

This section is intended for code contributors.

First ensure that you have [pnpm](https://pnpm.io) and [Node.js](https://nodejs.org) installed in
your development environment.

Next, install the project's dependencies:

```sh
pnpm install
```

To run the demo (for local development) with documentation:

```sh
pnpm dev
# demo site should now be available from `http://localhost:4321/unbikit/`
```

To run linting/formatting/type-checking and run tests:

```sh
pnpm check
```

To run tests in "watch mode" with the Vitest UI:

```sh
pnpm test
# demo site should now be available from `http://localhost:51712/__vitest__/`
```

To run tests and generate a code coverage report:

```sh
pnpm test:coverage
```

To run the benchmarks:

```sh
pnpm bench
```

To build for production:

```sh
pnpm build
```

To build the demo and documentation for production and then view it:

```sh
pnpm build:app
pnpm preview:app
# demo site should now be available from `http://localhost:4321/unbikit/`
```

Verification is performed by the CI flow for all pull requests before they can be merged to the
main branch. Commit logs are checked for
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
compliance as part of this flow.

## References

Sources of reference material about decoding the `.bik` format:

- [MultimediaWiki pages on the file format](https://wiki.multimedia.cx/index.php/Bink_Container)
- [Kostya's Boring Codec World](https://codecs.multimedia.cx/)
- [libav](https://git.ffmpeg.org/gitweb/ffmpeg.git),
  which contains a complete `.bik` decoder implementation
  (see the [FFmpeg website](https://ffmpeg.org/) for more information)
- [Wikipedia](https://www.wikipedia.org/) for overviews of the mathematical transformations
  involved with video decoding
- research papers on efficient algorithm implementations (searchable online):
  - Arai-Agui-Nakajima (AAN) IDCT algorithm
  - Cooley-Tukey FFT algorithm for IRDFT
  - Byeong Gi Lee (1984) IDCT algorithm

## License

This software is distributed under Apache License (Version 2.0) or MIT License
terms, at your option.

See [LICENSE](../LICENSE.md) for details.

**SPDX-License-Identifier: MIT OR Apache-2.0**

## Bink Video Licensing

The `.bik` file format is a proprietary format used by
[Bink Video](https://www.radgametools.com/bnkmain.htm), developed by
[Epic Games Tools](https://www.radgametools.com/) (formerly RAD Game Tools).
The redistribution of Bink Video files may require an additional license from
Epic Games Tools. More information can be found in their
[Bink FAQ](https://www.radgametools.com/binkfaq.htm).
