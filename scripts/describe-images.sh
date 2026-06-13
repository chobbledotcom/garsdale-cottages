#!/usr/bin/env bash
# Generate an exhaustive text description alongside each image using `llm-img`.
#
# For every image under images/ and assets/ (excluding the Leaflet UI icons),
# this writes a sibling "<image>.<ext>.txt" file containing a detailed
# description plus suggested alt text and captions. These feed accurate alt
# tags and captions across the site.
#
# Resumable: images that already have a non-empty .txt are skipped.
# Usage:  scripts/describe-images.sh [-f] [-j N]
#   -f   force regenerate even if a .txt already exists
#   -j   parallelism (default 6)
set -o errexit
set -o nounset
set -o pipefail

force=0
jobs=6
while getopts "fj:" opt; do
  case "$opt" in
    f) force=1 ;;
    j) jobs="$OPTARG" ;;
    *) echo "Usage: $0 [-f] [-j N]" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")/.."

context_base="This image is from the website for Garsdale Cottages, two self-catering holiday cottages (Roger Pot and The Old Cart House) in Garsdale, a small rural valley near Sedbergh in Cumbria, within the Yorkshire Dales National Park, England."

describe_one() {
  local img="$1"
  local force="$2"
  local txt="${img}.txt"

  if [[ "$force" -eq 0 && -s "$txt" ]]; then
    echo "skip  $img"
    return 0
  fi

  local dir filename
  dir="$(dirname "$img")"
  filename="$(basename "$img")"

  local prompt="${context_base}

The image file path is '${img}', so its category folder is '${dir}' and its filename is '${filename}'. Use this only as a hint; describe only what you can actually see.

Give an exhaustive, factual, objective description of exactly what is visible in the image so it can be used to write accurate alt text and captions. Note the setting, subjects, colours, lighting, season and any text or signage. Do not invent details you cannot see. After the description, suggest short, medium and detailed alt text, and a few caption ideas."

  if out="$(llm-img -i "$img" -p "$prompt" 2>/dev/null)" && [[ -n "$out" ]]; then
    printf '%s\n' "$out" > "$txt"
    echo "done  $img"
  else
    echo "FAIL  $img" >&2
    return 1
  fi
}
export -f describe_one
export context_base

# Collect images, excluding the Leaflet map UI icons.
mapfile -t images < <(
  find images assets -type f \
    \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \
       -o -iname '*.webp' -o -iname '*.gif' -o -iname '*.avif' \) \
    -not -path 'assets/leaflet/*' | sort
)

echo "Found ${#images[@]} images, parallelism=${jobs}, force=${force}"
printf '%s\0' "${images[@]}" \
  | xargs -0 -P "$jobs" -I {} bash -c 'describe_one "$@"' _ {} "$force"

echo "All done."
