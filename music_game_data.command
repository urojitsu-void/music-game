#!/bin/bash
set -u

export PATH="${PATH:-}:/opt/homebrew/bin:/usr/local/bin"

project_dir=$(cd "$(dirname "$0")" && pwd) || exit 1

if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display alert "Node.js/npmが見つかりません。Node.jsをインストールしてください。"' >/dev/null
  exit 1
fi

input=$(osascript -e 'POSIX path of (choose file with prompt "ゲームデータを作るMP3、MP4、またはMOVを選んでください" of type {"public.mp3", "public.mpeg-4", "com.apple.quicktime-movie"})') || exit 0

subtitle_choice=$(osascript -e 'button returned of (display dialog "字幕を追加しますか？（LRC / SRT）" buttons {"字幕なし", "字幕を選ぶ"} default button "字幕なし")') || exit 0
subtitle_args=(--no-subtitle)
if [ "$subtitle_choice" = "字幕を選ぶ" ]; then
  subtitle=$(osascript -e 'POSIX path of (choose file with prompt "字幕（LRCまたはSRT）を選んでください")') || exit 0
  case "$subtitle" in
    *.[lL][rR][cC]|*.[sS][rR][tT]) ;;
    *)
      osascript -e 'display alert "LRCまたはSRTファイルを選択してください。"' >/dev/null
      exit 1
      ;;
  esac
  subtitle_args=(--subtitle "$subtitle")
fi

cd "$project_dir" || exit 1
npm run data:build -- "$input" "${subtitle_args[@]}"
status=$?

if [ "$status" -eq 0 ]; then
  osascript -e 'display notification "背景動画と譜面を作成しました" with title "ゲームデータ生成完了"' >/dev/null
else
  osascript -e 'display alert "ゲームデータ生成に失敗しました。ターミナルのログを確認してください。"' >/dev/null
fi

echo "Enterキーで閉じます。"
if [ -t 0 ]; then
  read -r _
fi
exit "$status"
