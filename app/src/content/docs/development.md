---
title: Development
next: false
prev: false
---

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
