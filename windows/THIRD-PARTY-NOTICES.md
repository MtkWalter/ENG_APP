# Third-party notices

The bundled dictionary and JavaScript assets were recovered without modification from the user's Milo English Android 2.0.0 arm64 APK at repository commit `096f0b024a316690e15ae05d60683ca0c197750b`. `assets/android/integrity.json` records the APK and database SHA-256 values.

Full CMUdict BSD-style and ECDICT MIT license texts are retained in `assets/android/dictionary_sources.txt` (identical to the Android distribution's notice). Dictionary metadata retains upstream source hashes. KK is a transcription of American ARPABET, not a publisher-authored KK field.

Optional translation model: [Helsinki-NLP/opus-mt-en-zh](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh), Apache-2.0, with ONNX weights from [Xenova/opus-mt-en-zh](https://huggingface.co/Xenova/opus-mt-en-zh/tree/046f55aec303cdee3e0318604406d4df20f1e8ea). It is downloaded only when the user presses the model download button. The weights are not included in the application installer. [Apache-2.0 license](https://www.apache.org/licenses/LICENSE-2.0).

Runtime dependencies include Electron (MIT, plus Chromium and Node notices shipped with Electron), Transformers.js (Apache-2.0), ONNX Runtime (MIT), OpenCC-JS (MIT), sql.js (MIT), sharp (Apache-2.0), and their bundled dependencies. Their individual license files are retained in the application archive. Electron's `LICENSE` and `LICENSES.chromium.html` are included alongside the executable.

Microsoft Visual C++ x64 runtime DLLs are bundled as app-local dependencies for the native inference libraries. Copyright Microsoft Corporation. [Runtime redistribution terms](https://visualstudio.microsoft.com/license-terms/vs2022-cruntime/). The build reads these redistributable files from the Windows build machine's runtime installation or the explicit `MILO_CRT_DIR` directory.

ChatGPT and OpenAI are trademarks of OpenAI. Milo is an independent client interface and does not imply affiliation or endorsement.
