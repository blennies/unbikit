# unbikit

[![npm package minimized gzipped size](https://img.shields.io/bundlejs/size/unbikit)](https://bundlejs.com/?q=unbikit)
![NPM Version](https://img.shields.io/npm/v/unbikit)
[![NPM License](https://img.shields.io/npm/l/unbikit)](../LICENSE.md)
<br>
![isomorphic package badge](https://img.shields.io/badge/isomorphic-ECDC5A.svg?style=for-the-badge)
![Rolldown](https://img.shields.io/badge/rolldown-FF7E17?style=for-the-badge&logo=rolldown&logoColor=white)
![TypeScript badge](https://img.shields.io/badge/typescript-007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
[![PNPM badge](https://img.shields.io/badge/pnpm-4a4a4a.svg?style=for-the-badge&logo=pnpm&logoColor=f69220)](https://pnpm.io)
[![Conventional Commits badge](https://img.shields.io/badge/Conventional%20Commits-1.0.0-FE5196?style=for-the-badge&logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org)

> [!CAUTION]
> This package is at a very early development stage. Expect **_major_** API changes!

## Introduction

unbikit (_un-bik-ɪt_) is a decoder for `.bik` video files that can be used to play or transcode
videos.

### Features

- Supports Bink 1, revisions `c` to `i` inclusive
- Handles demuxing and decompression of audio and video streams
- TypeScript/JavaScript only (no WASM or native code)
- Uses Web Streams API for efficient reading of video files
- Isomorphic
  - runs on client/server runtimes that support at least ES2022
  - can be run with older runtimes by using the syntax lowering feature of some bundlers

### Limitations

- No support for Bink 2 or for revision `b` of Bink 1
- Some image corruption has been observed with some non-`i` revision videos

## Getting started

To install the decoder:

```sh
npm install unbikit
```

To use it:

```typescript
import { BikDecoder, type BikFrame } from "unbikit";

let stream: ReadableStream;
// ... assign a source to the stream
const decoder = await BikDecoder.open(() => stream);
let frame: BikFrame | null;
while ((frame = await decoder?.getNextFrame())) {
  // ... process frame
}
```

**_TODO: Add more installation instructions and more detailed usage instructions/examples_**

## Development

This section is intended for code contributors to this project.

First, ensure that you have [pnpm](https://pnpm.io) and [Node.js](https://nodejs.org) installed in
your development environment.

To install dependencies:

```sh
pnpm install
```

<!-- To run for local development:

```sh
pnpm dev
``` -->

To run linting/formatting/type-checking:

```sh
pnpm check
```

To build for production:

```sh
pnpm build
```

To build and view the documentation:

```sh
pnpm build:docs
pnpm preview:docs
```

Verification is performed by the CI flow for all pull requests before they can be merged to the
main branch. Commit logs are checked for
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
compliance as part of this flow.

## References

Sources of reference material about decoding the `.bik` format:

- [MultimediaWiki pages on the file format](https://wiki.multimedia.cx/index.php/Bink_Container)
- [Kostya's Boring Codec World](https://codecs.multimedia.cx/)
- libav (see the [FFmpeg website](https://ffmpeg.org/))
- [Wikipedia](https://www.wikipedia.org/) for information about various mathematical
  transformations
- related research papers on efficient algorithm implementations (searchable online):
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
