# unbikit

[![minzipped bundle size](https://img.shields.io/bundlejs/size/unbikit?style=flat-square)](https://bundlejs.com/?q=unbikit)
[![types included](https://img.shields.io/npm/types/unbikit?style=flat-square)](https://www.npmjs.com/package/unbikit)

<img src="/app/src/images/unbikit-logo.svg" alt="logo of unbikit" width="24" height="24"> unbikit
(_un-bik-ɪt_) is a decoder for `.bik` ([Bink Video](https://en.wikipedia.org/wiki/Bink_Video))
files that can be used to play or transcode videos. The format was first released in 1999 and has
since been used in many classic computer games.

⭐ [Documentation](https://blennies.github.io/unbikit/) and a
⭐ [video player demo](https://blennies.github.io/unbikit/demo/)
are available, as well as a
[repository page on GitHub](https://github.com/blennies/unbikit)!

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

## License

This software is distributed under Apache License (Version 2.0) or MIT License
terms, at your option.

See [LICENSE](./LICENSE.md) for details.

**SPDX-License-Identifier: MIT OR Apache-2.0**

## Bink Video Licensing

The `.bik` file format is a proprietary format used by
[Bink Video](https://www.radgametools.com/bnkmain.htm), developed by
[Epic Games Tools](https://www.radgametools.com/) (formerly RAD Game Tools).
The redistribution of Bink Video files may require an additional license from
Epic Games Tools. More information can be found in their
[Bink FAQ](https://www.radgametools.com/binkfaq.htm).
