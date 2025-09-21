# アセット運用メモ (GIF/動画など)

## GIF 変換手順 (ffmpeg)

### シンプル変換
```bash
ffmpeg -i demo.mp4 demo.gif


⸻

推奨: パレット方式 (高品質 & 背景が白く綺麗)

# パレット作成
ffmpeg -i demo.mp4 -vf "fps=15,scale=960:-1:flags=lanczos,palettegen" palette.png

# パレット適用して GIF 出力
ffmpeg -i demo.mp4 -i palette.png \
  -filter_complex "fps=15,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse" demo.gif


⸻

背景をさらに白寄せしたい場合

# パレット作成 (明るさ/コントラスト補正)
ffmpeg -i demo.mp4 -vf "fps=15,scale=960:-1:flags=lanczos,eq=brightness=0.05:contrast=1.1,palettegen" palette.png

# GIF 出力
ffmpeg -i demo.mp4 -i palette.png \
  -filter_complex "fps=15,scale=960:-1:flags=lanczos,eq=brightness=0.05:contrast=1.1[x];[x][1:v]paletteuse" demo.gif


⸻

GIF サイズの目安 (GitHub 用)
	•	GitHub は 100MB 未満 なら GIF アップ可能
	•	README 用デモとしては 1〜5MB 程度が望ましい
	•	3MB 程度なら全く問題なし
	•	10MB を超えると読み込みが重くなるので注意
	•	fps=10〜15 / 横幅=600〜800px 程度にすると軽量＆見やすさのバランスが良い

⸻

補足
	•	GIF をさらに軽くしたい場合は、README に mp4 / webm を埋め込む選択肢もある
（ただし GitHub 上ではクリック再生になる）
	•	アセットはリポジトリ直下に置くと参照しやすい (demo.gif 推奨)

⸻


