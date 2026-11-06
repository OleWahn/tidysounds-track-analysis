# TidySounds track analysis

The analysis service of [TidySounds](https://tidysounds-a639c.web.app): it recognizes which track a band's rehearsal recording belongs to, by comparing the recording's chroma with the chroma of every take the band already assigned.

This folder is its own Firebase Functions codebase (`analysis` in `firebase.json`). It is published under the GNU Affero General Public License v3 (see `LICENSE`), because it depends on [essentia.js](https://github.com/MTG/essentia.js), which is AGPL-3.0. The rest of TidySounds is a separate program that talks to this service over HTTP and Firestore and is not covered by this licence.

## What it does

`analyzeRecording` is an HTTP function with a private invoker: only principals with `roles/run.invoker` on it can call it, with a Google ID token. TidySounds grants that to its functions' runtime service account and to the service account its migrations run as.

```
POST /
{ "communityId": "...", "recordingId": "...", "downloadUrl": "https://...", "mode": "propose" | "features" }
```

1. It downloads the recording from the temporary URL, decodes it with ffmpeg to mono PCM, and extracts beat-synchronous HPCP chroma with essentia.js. The features are stored at `communities/{communityId}/recordings/{recordingId}/analysis/features` and reused.
2. In mode `propose` it reads the stored features of every assigned recording of the band, scores each track by its best-matching take (essentia's cover song similarity), applies a threshold and a margin, and writes `communities/{communityId}/recordings/{recordingId}/analysis/proposal`.

It reads and writes only those two documents plus the band's tracks and recordings. It holds no storage credentials; the download URL is handed in.

## Run and test

```
npm install
npm test
npm run build
```

The service is deployed with `firebase deploy --only functions:analysis` from the TidySounds repository, where this folder lives at `functions-analysis/`.

## Source

The published copy of this folder lives at https://github.com/OleWahn/tidysounds-track-analysis, linked from the TidySounds app under Settings, "Track analysis source". It is refreshed with `npm run publish:analysis` from the TidySounds repository before every release that changes it.
