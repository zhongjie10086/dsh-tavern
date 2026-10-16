#!/bin/sh

set -eu
case "${DSH_TAVERN_OFFLINE:-}" in
  1|true|TRUE) printf '%s\n' '离线模式禁止下载安装或更新；请使用已有安装。' >&2; exit 1 ;;
esac

# Inherit the registry throughout bootstrap, Profile and plugin installation.
export npm_config_registry="${DSH_TAVERN_NPM_REGISTRY:-https://registry.npmmirror.com}"
# pnpm 11 reads pnpm_config_* instead of npm_config_*.
export pnpm_config_registry="$npm_config_registry"

INSTALL_HOST=${DSH_TAVERN_HOST:-cli}
case ${INSTALL_HOST} in
  cli|desktop) ;;
  *) echo "安装失败：不支持的安装宿主 ${INSTALL_HOST}" >&2; exit 1 ;;
esac

REPOSITORY=${DSH_TAVERN_REPOSITORY:-zhongjie10086/dsh-tavern}
RELEASE_REF=release-r15-clean
REPOSITORY_URL=${DSH_TAVERN_GIT_URL:-https://github.com/${REPOSITORY}.git}
ARCHIVE_URL=${DSH_TAVERN_ARCHIVE_URL:-https://codeload.github.com/${REPOSITORY}/tar.gz/refs/heads/${RELEASE_REF}}
COMMIT_URL=${DSH_TAVERN_COMMIT_URL:-https://api.github.com/repos/${REPOSITORY}/commits/${RELEASE_REF}}
CDN_METADATA_URL=${DSH_TAVERN_CDN_METADATA_URL:-https://cdn.jsdelivr.net/gh/${REPOSITORY}@${RELEASE_REF}/dsh-tavern-runtime.json}
CDN_ROOT_URL=${DSH_TAVERN_CDN_ROOT_URL:-https://cdn.jsdelivr.net/gh/${REPOSITORY}}
LEGACY_DSH_ROOT=${DSH_TAVERN_LEGACY_DSH_HOME:-${DSH_HOME:-${HOME}/.dsh}}
DSH_ROOT=${DSH_HOME:-${HOME}/.dsh}
if [ "${INSTALL_HOST}" = "cli" ]; then
  # CLI directory selection: explicit paths and existing installations never prompt.
  DSH_ROOT=${DSH_TAVERN_CLI_HOME:-}
  if [ -z "$DSH_ROOT" ]; then
    if [ -f "$PWD/apps/dsh-tavern/.dsh-tavern-local.json" ] || [ -f "$PWD/.dsh-tavern-install-root" ]; then
      DSH_ROOT=$PWD
    elif [ -f "$HOME/.dsh-tavern/apps/dsh-tavern/.dsh-tavern-local.json" ] || [ -f "$HOME/.dsh-tavern/.dsh-tavern-install-root" ]; then
      DSH_ROOT=$HOME/.dsh-tavern
    else
      if ! ( : </dev/tty ) 2>/dev/null; then
        echo '无法交互选择安装目录。请设置 DSH_TAVERN_CLI_HOME 后重新运行。' >&2
        exit 1
      fi
      printf '\n请选择 CLI 安装目录：\n  1. 默认目录：%s/.dsh-tavern\n  2. 当前目录：%s（回车默认）\n  3. 其他目录\n程序、运行时和游戏数据存入所选目录；命令入口和包管理器缓存可能位于目录外。\n' "$HOME" "$PWD" >/dev/tty
      while :; do
        printf '请选择 [1/2/3，默认 2]：' >/dev/tty
        IFS= read -r choice </dev/tty || exit 1
        case "$choice" in
          1) DSH_ROOT=$HOME/.dsh-tavern; break ;;
          2|'') DSH_ROOT=$PWD; break ;;
          3) printf '请输入完整安装路径：' >/dev/tty
             IFS= read -r DSH_ROOT </dev/tty || exit 1
             case "$DSH_ROOT" in /*) break ;; *) echo '请输入绝对路径。' >/dev/tty ;; esac ;;
          *) echo '请输入 1、2 或 3。' >/dev/tty ;;
        esac
      done
    fi
  fi
  case "$DSH_ROOT" in /*) ;; *) DSH_ROOT=$PWD/$DSH_ROOT ;; esac
  if [ ! -f "$DSH_ROOT/apps/dsh-tavern/.dsh-tavern-local.json" ] && [ ! -f "$DSH_ROOT/.dsh-tavern-install-root" ]; then
    for entry in apps runtime tools profiles profile-data source-cache logs backups settings.yaml; do
      if [ -e "$DSH_ROOT/$entry" ] || [ -L "$DSH_ROOT/$entry" ]; then
        echo "安装目录存在冲突：$DSH_ROOT/$entry。请选择空目录，或使用原有安装目录。" >&2
        exit 1
      fi
    done
  fi
  printf 'CLI 安装目录：%s\n' "$DSH_ROOT"
  mkdir -p "$DSH_ROOT"
  printf 'cli-v1\n' > "$DSH_ROOT/.dsh-tavern-install-root"
  DSH_TAVERN_CLI_HOME=${DSH_ROOT}
  DSH_TAVERN_LEGACY_DSH_HOME=${LEGACY_DSH_ROOT}
  export DSH_TAVERN_CLI_HOME DSH_TAVERN_LEGACY_DSH_HOME
fi
DSH_HOME=${DSH_ROOT}
export DSH_HOME
APP_DIR=${DSH_TAVERN_APP_DIR:-${DSH_ROOT}/apps/dsh-tavern}
RUNTIME_ROOT=${DSH_ROOT}/tools
RUNTIME_BIN=${RUNTIME_ROOT}/bin
PNPM_VERSION=11.25.0
COMMAND_BIN=${HOME}/.local/bin
SOURCE_CACHE=${DSH_ROOT}/source-cache/dsh-tavern.git
RUNTIME_PATHS='dsh-tavern-runtime.json package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml install.ps1 install.sh bin config presets tavern-plugin patches'
TMP_BASE=${TMPDIR:-/tmp}
TMP_BASE=${TMP_BASE%/}
TEMP_DIR=$(mktemp -d "${TMP_BASE}/dsh-tavern-install.XXXXXX")
REQUESTED_COMMIT=${DSH_TAVERN_TARGET_COMMIT:-}
TARGET_COMMIT=${REQUESTED_COMMIT}
FETCH_REF=${REQUESTED_COMMIT:-${RELEASE_REF}}

cleanup() {
  case "${TEMP_DIR}" in
    "${TMP_BASE}"/dsh-tavern-install.*) rm -rf -- "${TEMP_DIR}" ;;
  esac
}
trap cleanup EXIT HUP INT TERM

fail() {
  echo "安装失败：$1" >&2
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  echo "需要先安装 Node.js 22.19 或更高版本：https://nodejs.org/" >&2
  if command -v open >/dev/null 2>&1; then open https://nodejs.org/ >/dev/null 2>&1 || true; fi
  fail "未找到 Node.js。安装后重新运行本命令。"
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)' >/dev/null 2>&1; then
  fail "Node.js 版本过低，需要 22.19 或更高版本（当前：$(node --version)）。"
fi

if [ "${INSTALL_HOST}" = "cli" ] && ! command -v npm >/dev/null 2>&1; then
  fail "未找到 npm，请重新安装 Node.js。"
fi

# UI updates start in a fresh process that may not inherit the install-time PATH.
# Only CLI may use Tavern-managed tools; Desktop must keep its host PATH.
if [ "${INSTALL_HOST}" = "cli" ]; then
  PATH=${RUNTIME_BIN}:${PATH}
  export PATH
fi

if [ "${INSTALL_HOST}" = "cli" ]; then
  DSH_TAVERN_BIN_DIR=${COMMAND_BIN}
  export DSH_TAVERN_BIN_DIR
fi

command -v tar >/dev/null 2>&1 || fail "未找到 tar。"

echo "正在增量同步 DSH Tavern……"
USED_GIT=0
USED_CDN=0
if command -v git >/dev/null 2>&1; then
  echo "正在通过 Git 增量同步（不下载文档与图片）……"
  mkdir -p "$(dirname -- "${SOURCE_CACHE}")"
  if { [ -f "${SOURCE_CACHE}/HEAD" ] || git clone --bare --filter=blob:none --depth 1 --single-branch --branch "${RELEASE_REF}" "${REPOSITORY_URL}" "${SOURCE_CACHE}"; } \
    && git --git-dir="${SOURCE_CACHE}" remote set-url origin "${REPOSITORY_URL}" \
    && git --git-dir="${SOURCE_CACHE}" fetch --depth 1 origin "${FETCH_REF}" \
    && TARGET_COMMIT=$(git --git-dir="${SOURCE_CACHE}" rev-parse FETCH_HEAD) \
    && git -c core.autocrlf=false -c core.eol=lf --git-dir="${SOURCE_CACHE}" archive --format=tar --output="${TEMP_DIR}/app.tar" FETCH_HEAD -- ${RUNTIME_PATHS}; then
    USED_GIT=1
  else
    echo "Git 增量更新不可用，将回退到完整 ZIP。" >&2
  fi
fi

if [ "${USED_GIT}" -eq 0 ]; then
  echo "GitHub 直连不可用，正在通过 jsDelivr 备用源下载运行代码……"
  mkdir -p "${TEMP_DIR}/cdn-source"
  if CDN_METADATA_URL="${CDN_METADATA_URL}" CDN_ROOT_URL="${CDN_ROOT_URL}" CDN_SOURCE="${TEMP_DIR}/cdn-source" REQUESTED_COMMIT="${REQUESTED_COMMIT}" node <<'NODE'
const { createHash } = require('node:crypto')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const allowed = /^(scripts\/(?:lib\/(?:r16-page-home-rehearsal|r16-page-home-verification|r5-candidate-tools|r5-recovery-tools)|r5-recovery-preflight|r5-recovery-rehearsal)\.mjs$|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|cordis\.patch\.yml|install\.ps1|install\.sh|bin\/|config\/|presets\/|tavern-plugin\/|patches\/)/
async function get(url, timeout = 30000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response
}
;(async () => {
  const metadata = await (await get(process.env.CDN_METADATA_URL, 15000)).json()
  if (process.env.REQUESTED_COMMIT && metadata.revision !== process.env.REQUESTED_COMMIT) throw new Error('备用源尚未发布已确认提交，改用固定提交归档')
  if (!/^[0-9a-f]{40}$/i.test(String(metadata.revision || ''))) throw new Error('jsDelivr 运行清单缺少有效提交号')
  const files = (metadata.files || []).map((file) => ({ ...file, path: String(file.path || '').replace(/^\/+/, '') }))
    .filter((file) => allowed.test(file.path) && !file.path.split('/').includes('..') && /^[0-9a-f]{64}$/i.test(String(file.sha256 || '')))
  if (files.length === 0) throw new Error('jsDelivr 未返回运行文件清单')
  for (const file of files) {
    const bytes = Buffer.from(await (await get(`${process.env.CDN_ROOT_URL}@${metadata.revision}/${file.path}`)).arrayBuffer())
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== String(file.sha256).toLowerCase()) throw new Error(`jsDelivr 文件校验失败：${file.path}`)
    const target = path.join(process.env.CDN_SOURCE, ...file.path.split('/'))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  await writeFile(path.join(process.env.CDN_SOURCE, 'dsh-tavern-runtime.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  await writeFile(path.join(process.env.CDN_SOURCE, '.revision'), metadata.revision)
})().catch((error) => { console.error(error.message); process.exit(1) })
NODE
  then
    USED_CDN=1
    TARGET_COMMIT=$(cat "${TEMP_DIR}/cdn-source/.revision")
    rm -f -- "${TEMP_DIR}/cdn-source/.revision"
  else
    echo "jsDelivr 备用源不可用，将回退到完整 ZIP。" >&2
  fi
fi

if [ "${USED_GIT}" -eq 0 ] && [ "${USED_CDN}" -eq 0 ]; then
  command -v curl >/dev/null 2>&1 || fail "Git 不可用且未找到 curl，无法下载完整 ZIP。"
  echo "正在下载完整 ZIP……"
  TARGET_COMMIT=${REQUESTED_COMMIT}
  if [ -z "${TARGET_COMMIT}" ]; then
    TARGET_COMMIT=$(curl -fsSL --connect-timeout 10 "${COMMIT_URL}" | sed -n 's/^[[:space:]]*"sha":[[:space:]]*"\([0-9a-fA-F]*\)".*/\1/p' | head -n 1 || true)
  fi
  [ -n "${TARGET_COMMIT}" ] || fail "无法确认下载提交号，尚未覆盖现有安装。"
  ARCHIVE_URL=${DSH_TAVERN_ARCHIVE_URL:-https://codeload.github.com/${REPOSITORY}/tar.gz/${TARGET_COMMIT}}
  curl -fL --retry 3 --connect-timeout 15 "${ARCHIVE_URL}" -o "${TEMP_DIR}/app.tar.gz"
fi
mkdir -p "${TEMP_DIR}/extract"
if [ "${USED_CDN}" -eq 1 ]; then
  SOURCE_DIR=${TEMP_DIR}/cdn-source
elif [ "${USED_GIT}" -eq 1 ]; then
  tar -xf "${TEMP_DIR}/app.tar" -C "${TEMP_DIR}/extract"
  SOURCE_DIR=${TEMP_DIR}/extract
else
  tar -xzf "${TEMP_DIR}/app.tar.gz" -C "${TEMP_DIR}/extract"
  SOURCE_DIR=$(find "${TEMP_DIR}/extract" -mindepth 1 -maxdepth 1 -type d | head -n 1)
fi
[ -n "${SOURCE_DIR}" ] || fail "下载内容不完整。"
[ -f "${SOURCE_DIR}/package.json" ] || fail "下载内容不完整。"

# BEGIN INSTALL SOURCE VERIFICATION
node --input-type=module - "${APP_DIR}" "${SOURCE_DIR}" "${TARGET_COMMIT}" "${REQUESTED_COMMIT}" "${SOURCE_CACHE}" <<'VERIFY_INSTALL_SOURCE'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const commitPattern = /^[0-9a-f]{40}$/i
function json(file) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : null }
function metadata(root) {
  const value = json(path.join(root, 'dsh-tavern-runtime.json'))
  if (!value || !commitPattern.test(value.revision) || !Number.isSafeInteger(value.releaseSequence) || !value.files?.length) return null
  for (const file of value.files) {
    const relative = path.relative(root, path.resolve(root, file.path))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
    try { if (createHash('sha256').update(readFileSync(path.join(root, file.path))).digest('hex') !== file.sha256) return null }
    catch { return null }
  }
  return value
}
function versionOrder(left, right) {
  const parse = value => String(value).split('-')[0].split('.').map(Number)
  const a = parse(left), b = parse(right)
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(n => !Number.isSafeInteger(n) || n < 0)) throw Error('无法验证安装版本号')
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i])
  return 0
}

export function verifyInstallSource({ appDir, sourceDir, targetCommit, requestedCommit = '', sourceCache = '' }) {
  if (!commitPattern.test(targetCommit)) throw Error('下载结果缺少可验证提交号，未覆盖现有安装')
  if (requestedCommit && targetCommit.toLowerCase() !== requestedCommit.toLowerCase()) throw Error('备用下载源提交与已确认目标不同，拒绝安装缓存的旧版本')
  const candidate = json(path.join(sourceDir, 'package.json'))
  if (!candidate) throw Error('下载内容不完整')
  const current = json(path.join(appDir, 'package.json'))
  if (!current) return
  const order = versionOrder(candidate.version, current.version)
  if (order < 0) throw Error('下载版本低于当前安装，拒绝降级')
  const oldMetadata = metadata(appDir), nextMetadata = metadata(sourceDir)
  if (oldMetadata && nextMetadata) {
    if (nextMetadata.releaseSequence < oldMetadata.releaseSequence || (nextMetadata.releaseSequence === oldMetadata.releaseSequence && nextMetadata.revision !== oldMetadata.revision)) throw Error('备用源发布序号较旧或冲突，拒绝覆盖')
    return
  }
  const release = json(path.join(appDir, '.dsh-tavern-release.json'))
  let currentCommit = oldMetadata?.revision || release?.commit || ''
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  if (!currentCommit && existsSync(path.join(appDir, '.git'))) {
    try { currentCommit = git('-C', appDir, 'rev-parse', 'HEAD') } catch {}
  }
  if (currentCommit === targetCommit) return
  // A requested commit was checked before launching the updater. Every fallback must match it.
  if (requestedCommit === targetCommit) return
  if (order > 0) return
  if (commitPattern.test(currentCommit)) {
    for (const args of [['-C', appDir], ...(sourceCache ? [['--git-dir=' + sourceCache]] : [])]) {
      try { git(...args, 'merge-base', '--is-ancestor', currentCommit, targetCommit); return } catch {}
    }
  }
  throw Error('无法确认下载内容比当前构建更新；请先在酒馆检查更新后重试，现有安装未覆盖')
}

verifyInstallSource({appDir:process.argv[2],sourceDir:process.argv[3],targetCommit:process.argv[4],requestedCommit:process.argv[5] === '-' ? '' : process.argv[5],sourceCache:process.argv[6]})
VERIFY_INSTALL_SOURCE
# END INSTALL SOURCE VERIFICATION

# Read the downloaded release's version, not the bootstrap script's or npm's latest.
ADAPTED_DSH_VERSION=$(node "${SOURCE_DIR}/bin/dsh-compatibility.mjs" --version)
node "${SOURCE_DIR}/bin/dsh-compatibility.mjs" --notice "${INSTALL_HOST}"
if [ "${INSTALL_HOST}" = "cli" ]; then
  set --
  INSTALLED_PNPM_VERSION=$(pnpm --version 2>/dev/null || true)
  if [ "${INSTALLED_PNPM_VERSION}" != "${PNPM_VERSION}" ]; then
    set -- "$@" "pnpm@${PNPM_VERSION}"
  fi
  if [ "$#" -gt 0 ]; then
    echo "正在安装缺失依赖：$*……"
    mkdir -p "${RUNTIME_ROOT}"
    npm install --global --prefix "${RUNTIME_ROOT}" "$@"
  fi
fi
command -v pnpm >/dev/null 2>&1 || fail "未找到 pnpm。Desktop 版请从 DSH Desktop 托盘打开 DSH Terminal 后运行本命令。"
[ "${INSTALL_HOST}" = "cli" ] || command -v dsh >/dev/null 2>&1 || fail "未找到 DSH。Desktop 版请从 DSH Desktop 托盘打开 DSH Terminal 后运行本命令。"

# Validate the downloaded release against the host before replacing any app files.
if [ "${INSTALL_HOST}" != "cli" ]; then
  CURRENT_DSH_VERSION=$(dsh --version) || fail "无法读取宿主 DSH 版本。"
  node "${SOURCE_DIR}/bin/dsh-compatibility.mjs" --check "${INSTALL_HOST}" "${CURRENT_DSH_VERSION}"
fi

if [ "${INSTALL_HOST}" = "cli" ] && [ -f "${APP_DIR}/bin/dsh-tavern.mjs" ]; then
  DSH_HOME=${DSH_ROOT} node "${APP_DIR}/bin/dsh-tavern.mjs" stop || fail "旧服务未能安全停止，尚未覆盖程序文件。"
fi

mkdir -p "${APP_DIR}"
# 覆盖程序文件但不删除旧目录，因此未被发布包跟踪的 data/ 用户数据会保留。
cp -R "${SOURCE_DIR}/." "${APP_DIR}/"
if [ "${USED_CDN}" -eq 1 ]; then rm -f -- "${APP_DIR}/.dsh-tavern-release.json"; fi
case ${TARGET_COMMIT} in
  *[!0-9a-fA-F]*|'') ;;
  ????????????????????????????????????????)
    printf '{"commit":"%s","installedAt":"%s"}\n' "${TARGET_COMMIT}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"${APP_DIR}/.dsh-tavern-release.json"
    ;;
esac

echo "正在安装程序依赖……"
pnpm --dir "${APP_DIR}" install --frozen-lockfile

echo "正在配置 Tavern……"
DSH_HOME=${DSH_ROOT} node "${APP_DIR}/bin/dsh-tavern.mjs" install --host "${INSTALL_HOST}"

if [ "${INSTALL_HOST}" = "desktop" ]; then
  echo "DSH Tavern Desktop 版安装完成。"
  echo "请重启 DSH Desktop，再从托盘的 Profile 菜单切换到 tavern。"
else
  DSH_HOME=${DSH_ROOT} node "${APP_DIR}/bin/dsh-tavern.mjs" start
  case ${SHELL:-} in
    */zsh) SHELL_PROFILE=${HOME}/.zprofile ;;
    *) SHELL_PROFILE=${HOME}/.profile ;;
  esac
  PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
  if [ ! -f "${SHELL_PROFILE}" ] || ! grep -F "${PATH_LINE}" "${SHELL_PROFILE}" >/dev/null 2>&1; then
    printf '\n# DSH Tavern\n%s\n' "${PATH_LINE}" >>"${SHELL_PROFILE}"
  fi
  echo "DSH Tavern 安装完成。请使用上方完整访问地址，或运行 dsh-tavern open 打开网页。"
  echo "以后可以使用：dsh-tavern {start|open|stop|restart|status|update}（新终端生效）"
fi
