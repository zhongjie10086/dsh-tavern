import { readFile } from 'node:fs/promises'
import path from 'node:path'

// A local repair build is not a commit of upstream main, so the in-app updater
// must not "update" it by running the upstream installer over it (Z89). The
// marker lives under config/ so runtime-only archives keep it too.
export const LOCAL_BUILD_FILE = 'config/local-build.json'
export const LOCAL_BUILD_NOTICE = '这是本地修复版，已关闭应用内更新；请按交付说明更新。'

export async function readLocalBuild(sourceRoot) {
  let content
  try {
    content = await readFile(path.join(sourceRoot, ...LOCAL_BUILD_FILE.split('/')), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    // A marker that exists but cannot be read still means "local build";
    // failing open would hand the tree back to the upstream installer.
    return { notice: LOCAL_BUILD_NOTICE }
  }
  try {
    const notice = JSON.parse(content.replace(/^﻿/, ''))?.notice
    return { notice: typeof notice === 'string' && notice.trim() ? notice.trim() : LOCAL_BUILD_NOTICE }
  } catch {
    return { notice: LOCAL_BUILD_NOTICE }
  }
}
