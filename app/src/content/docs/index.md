---
title: unbikit
next: false
prev: false
---

<!-- REVISIT: grab most of this content from the GitHub README.md -->

[![package minzipped size](https://flat.badgen.net/bundlephobia/minzip/unbikit)](https://bundlephobia.com/package/unbikit)
[![version on NPM](https://flat.badgen.net/npm/v/unbikit)](https://www.npmjs.com/package/unbikit)
[![dependency count](https://flat.badgen.net/bundlephobia/dependency-count/unbikit)](https://bundlephobia.com/package/unbikit)
[![types included](https://flat.badgen.net/npm/types/unbikit)](https://www.npmjs.com/package/unbikit)
[![license](https://flat.badgen.net/npm/license/unbikit)](/unbikit/license)<br />
![isomorphic package badge](https://img.shields.io/badge/isomorphic-ECDC5A.svg?style=for-the-badge)
![Rolldown](https://img.shields.io/badge/rolldown-FF7E17?style=for-the-badge&logo=rolldown&logoColor=white)
![TypeScript
badge](https://img.shields.io/badge/typescript-007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
[![PNPM
badge](https://img.shields.io/badge/pnpm-4a4a4a.svg?style=for-the-badge&logo=pnpm&logoColor=f69220)](https://pnpm.io)
[![Conventional Commits
badge](https://img.shields.io/badge/Conventional%20Commits-1.0.0-FE5196?style=for-the-badge&logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org)

:::caution
This package is at an early development stage. Expect API changes!
:::

## Introduction

unbikit (_un-bik-ɪt_) is a decoder for `.bik` (Bink) video files that can be used to play or
transcode videos.

This site hosts the documentation for the decoder, as well as
⭐ [a video player demo](/unbikit/demo) and other information.

There is also a
[repository page on GitHub](https://github.com/blennies/unbikit)!

### Features

- Supports Bink 1, revisions `c` to `i` inclusive
- Handles demuxing and decompression of audio and video streams
- TypeScript/JavaScript only (no WASM or native code)
- No dependencies
- Uses Web Streams API for efficient reading of video files
- Isomorphic
  - runs on client/server runtimes that support at least ES2022
  - can be run with older runtimes by using the syntax lowering feature of some bundlers
