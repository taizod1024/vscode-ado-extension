# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.0.9](https://github.com/taizod1024/vscode-ado-extension/compare/v0.0.8...v0.0.9) (2026-05-15)


### Features

* add pipeline and pipeline run fetching functionality to AdoApiClient and update related components ([eeb9e09](https://github.com/taizod1024/vscode-ado-extension/commit/eeb9e097269aeeb83c617bca0184beefda7cd89a))


### Bug Fixes

* closes [#35](https://github.com/taizod1024/vscode-ado-extension/issues/35):open repositoryもワークスペースを確認して開く ([219984c](https://github.com/taizod1024/vscode-ado-extension/commit/219984cef9d10a05d144c8e3175c27629273e91e))
* closes [#36](https://github.com/taizod1024/vscode-ado-extension/issues/36):メッセージは英語に統一 ([efa6f60](https://github.com/taizod1024/vscode-ado-extension/commit/efa6f60feb6ddef7db268dab3db6b1178ffe1654))
* closes [#37](https://github.com/taizod1024/vscode-ado-extension/issues/37) ([d073708](https://github.com/taizod1024/vscode-ado-extension/commit/d07370895095911a3dbace6607f84ab1e11b164e))
* closes [#37](https://github.com/taizod1024/vscode-ado-extension/issues/37):Pipelinesを追加。同時に名前をBoards、Reposに変更 ([71c253b](https://github.com/taizod1024/vscode-ado-extension/commit/71c253bfe99fb8549f9d8fdd89ee771c71549c47))
* closes [#39](https://github.com/taizod1024/vscode-ado-extension/issues/39):HTTP404エラーのときにエラーアイコンが残った、リフレッシュで消えた ([2be8422](https://github.com/taizod1024/vscode-ado-extension/commit/2be84229fdfab9c5da77c3d480e30710618c317d))

### [0.0.8](https://github.com/taizod1024/vscode-ado-extension/compare/v0.0.7...v0.0.8) (2026-05-13)


### Bug Fixes

* [#33](https://github.com/taizod1024/vscode-ado-extension/issues/33):git graphは開いているワークスペースから検索する ([55fc2bd](https://github.com/taizod1024/vscode-ado-extension/commit/55fc2bd425144a95dacf57f520ac0851eef49181))
* org登録時はPAT入力前にorgを登録し、refresh時にPAT未入力orgを自動プロンプト ([#34](https://github.com/taizod1024/vscode-ado-extension/issues/34)) ([0a72ced](https://github.com/taizod1024/vscode-ado-extension/commit/0a72ced62a7f0ee8093430a32bf4b0b347fe1ccf))

### [0.0.7](https://github.com/taizod1024/vscode-ado-extension/compare/v0.0.6...v0.0.7) (2026-05-12)


### Features

* Pull Requests フィルタ行にリフレッシュボタンを追加 ([62d6658](https://github.com/taizod1024/vscode-ado-extension/commit/62d6658ac8a130a953131a553b970ca29073edbd))


### Bug Fixes

* git-graph.view に rootUri 形式で対象リポジトリを渡すよう修正 ([2de8bd5](https://github.com/taizod1024/vscode-ado-extension/commit/2de8bd550f482d79825125a348e36ca3ec9af17d))
* Todo/Doing/Done メニューを同状態でも常に表示 ([cecc73b](https://github.com/taizod1024/vscode-ado-extension/commit/cecc73b765c2db80c5906bb1e5d0d7c2f9f78cc8))
* ロード中はフィルタ行を非表示にしてローディング行のみ表示 ([209cbf6](https://github.com/taizod1024/vscode-ado-extension/commit/209cbf63308ad3ade8cdaf13e03dcdc3c09c07e2))

### [0.0.6](https://github.com/taizod1024/vscode-ado-extension/compare/v0.0.5...v0.0.6) (2026-05-12)


### Features

* add command to open Git Graph and integrate with Azure DevOps extension ([0d86566](https://github.com/taizod1024/vscode-ado-extension/commit/0d86566cafd5110d3836cbdc7d61f16f2cb845ff))
* add commands to update work item states and enhance context menu options ([6fa85a9](https://github.com/taizod1024/vscode-ado-extension/commit/6fa85a997ecb5092e9cf13ef02eac416d93fa311))


### Bug Fixes

* remove automatic reveal attempt of side panel in activate function ([36d5ffd](https://github.com/taizod1024/vscode-ado-extension/commit/36d5ffd394bec74fbf6066bc2510f4f79599f520))
* reorder return values in AdoTreeProvider to prioritize pull requests over branches ([51f0b17](https://github.com/taizod1024/vscode-ado-extension/commit/51f0b179fc8655964777788dff2ba12839d56b14))
* update repository URL in package.json for correct reference ([fb0dbfb](https://github.com/taizod1024/vscode-ado-extension/commit/fb0dbfbc55542232227b4deed6e0ec1679f40c58))

### [0.0.5](https://github.com/taizod1024/vscode-ado-ext-extension/compare/v0.0.4...v0.0.5) (2026-05-10)


### Bug Fixes

* correct display name in package.json for clarity ([83981fb](https://github.com/taizod1024/vscode-ado-ext-extension/commit/83981fb6483e4e5c9402027cb1d759dc00e97a1c))

### [0.0.4](https://github.com/taizod1024/vscode-ado-ext-extension/compare/v0.0.3...v0.0.4) (2026-05-10)


### Features

* add create Epic/Issue/Task to sprint nodes ([a5fdcf1](https://github.com/taizod1024/vscode-ado-ext-extension/commit/a5fdcf146729b8f8ca83b9d5485642176a518d95))
* Add default branch and branch name to AdoTreeItem; update pull request URL construction ([fafc999](https://github.com/taizod1024/vscode-ado-ext-extension/commit/fafc9999415c69df64cdd58d3353c19316e7f387))
* add refresh button to iteration filter node ([3eb2bcc](https://github.com/taizod1024/vscode-ado-ext-extension/commit/3eb2bcca3d437e8fbdcac2bf215e1eeea8a8e854)), closes [#20](https://github.com/taizod1024/vscode-ado-ext-extension/issues/20)
* Add repository icon to Repositories node toolbar (closes [#23](https://github.com/taizod1024/vscode-ado-ext-extension/issues/23)) ([b77e153](https://github.com/taizod1024/vscode-ado-ext-extension/commit/b77e15383d2f30e2e481ec53815614735f67cf92))
* add Sprint creation icon with checklist for Work Items ([dd301cb](https://github.com/taizod1024/vscode-ado-ext-extension/commit/dd301cb7b29e60db37951ed7284419137415ebef)), closes [#22](https://github.com/taizod1024/vscode-ado-ext-extension/issues/22) [#23](https://github.com/taizod1024/vscode-ado-ext-extension/issues/23)
* group work items by iteration with parent-child hierarchy ([a54f30e](https://github.com/taizod1024/vscode-ado-ext-extension/commit/a54f30e00d8c7f249c7feaed9dd9dfe706bad189)), closes [#20](https://github.com/taizod1024/vscode-ado-ext-extension/issues/20)
* openUrl を統合ブラウザ（Simple Browser）で開くよう変更 ([8ac01a6](https://github.com/taizod1024/vscode-ado-ext-extension/commit/8ac01a6181da8f9e38e669b33527b307c7503e34))
* Update pull request creation process and enhance README for clarity ([8d3ceb5](https://github.com/taizod1024/vscode-ado-ext-extension/commit/8d3ceb59252342be098bac610cb818e2f5da413d))
* フィルタボタンのトグル機能を削除し右クリックのみに変更 ([5d9758b](https://github.com/taizod1024/vscode-ado-ext-extension/commit/5d9758bd23e3a87ee1c6a9ba38bc20b1467d8137))
* フィルタボタンを右クリックでフィルタ選択できるように変更 ([7e726bb](https://github.com/taizod1024/vscode-ado-ext-extension/commit/7e726bbdf88bf70ae748106e4ca7881567c71716))
* フィルタ選択をコンテキストメニューに直接並べるよう変更 ([442b143](https://github.com/taizod1024/vscode-ado-ext-extension/commit/442b143d8d04bc137176d2b5e126adb031c32c29))
* フィルタ別ノードをフィルタボタンに変更 (Fixes [#13](https://github.com/taizod1024/vscode-ado-ext-extension/issues/13)) ([f3573b4](https://github.com/taizod1024/vscode-ado-ext-extension/commit/f3573b443a7341b57bb28d6b87fd4ae186ddf0a2))


### Bug Fixes

* change Sprints folder to collapsed state by default ([af56905](https://github.com/taizod1024/vscode-ado-ext-extension/commit/af56905e0cd84c6e05ac1e89c7e403f45f5b2fa7))
* correct openWorkItems command to always build work items URL ([4d00760](https://github.com/taizod1024/vscode-ado-ext-extension/commit/4d00760d8c6e4a03402b6ce81d4c3f9650db6c64))
* Improve error handling and argument validation in commands ([0c84a30](https://github.com/taizod1024/vscode-ado-ext-extension/commit/0c84a3015a1eb718901b044958cf8134be0ad4cf))
* organization以外のrefreshを削除 ([#19](https://github.com/taizod1024/vscode-ado-ext-extension/issues/19)) ([4499eb2](https://github.com/taizod1024/vscode-ado-ext-extension/commit/4499eb2b5f411b1dceabbf88e3da81aed5bbc62c))
* Work item hierarchy by explicitly fetching System.Parent field ([4362a29](https://github.com/taizod1024/vscode-ado-ext-extension/commit/4362a295a1b1a569905fc23b8dda7ba9a95dec0c))
* work itemのアイコン色を変更 (Fixes [#15](https://github.com/taizod1024/vscode-ado-ext-extension/issues/15)) ([b7cd15b](https://github.com/taizod1024/vscode-ado-ext-extension/commit/b7cd15b5ec1c14fdafb0d78a5411449f38c0a0b3))
* アイコンの色を変更 (Fixes [#16](https://github.com/taizod1024/vscode-ado-ext-extension/issues/16)) ([2f95cb4](https://github.com/taizod1024/vscode-ado-ext-extension/commit/2f95cb423020586e0312d915956ae8f324c2559d))
* コンテキストメニューのチェックマークを Unicode 文字に変更 ([340bbce](https://github.com/taizod1024/vscode-ado-ext-extension/commit/340bbce94ecdcdb7847a82d6d0bfe1582feba34d))
* フィルタアイコンを白色に変更、create branchアイコンをgit-branchに変更 ([abef845](https://github.com/taizod1024/vscode-ado-ext-extension/commit/abef845f1a60a632c69411577fbdc66c579223e1))
* フィルタ選択コマンドを右クリックメニューに表示するよう修正 ([ee2c062](https://github.com/taizod1024/vscode-ado-ext-extension/commit/ee2c0622c12b40a4a9faf14878b4fa63f119a622))
* フィルタ変更時にキャッシュを削除して再通信するよう修正 ([2cff3d1](https://github.com/taizod1024/vscode-ado-ext-extension/commit/2cff3d152ffc54c54e094eb6f421d7326b714ebe))

### [0.0.3](https://github.com/taizod1024/vscode-ado-ext-extension/compare/v0.0.2...v0.0.3) (2026-05-07)

### Bug Fixes

- correct display name in package.json ([38fe961](https://github.com/taizod1024/vscode-ado-ext-extension/commit/38fe9614816789f963c2be879a043b4a58a757ec))

### 0.0.2 (2026-05-07)

### Features

- add commands to create branch for work item and open settings ([4af289f](https://github.com/taizod1024/vscode-ado-ext-extension/commit/4af289f141761f631bafefb55f23b44da3ea4ea4))
- add new command to open URL in Azure DevOps side panel ([89c4a36](https://github.com/taizod1024/vscode-ado-ext-extension/commit/89c4a36665212720ad01922d96e51b21a23f51f0))

### Bug Fixes

- improve work item description retrieval and sanitize HTML tags ([d08ed44](https://github.com/taizod1024/vscode-ado-ext-extension/commit/d08ed4466bed680df81f479fc3cd2baf4b88568f))
- silently ignore openView command failure in older VS Code versions ([85b4709](https://github.com/taizod1024/vscode-ado-ext-extension/commit/85b47091539d6bef43108fa3ec31f20c9a0b5985))
- update command groups for openUrl in Azure DevOps side panel ([55e4559](https://github.com/taizod1024/vscode-ado-ext-extension/commit/55e4559f3fefef1036af85e57bbfc2fd9ead7039))
