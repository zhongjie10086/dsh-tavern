import { access, readFile, readdir, lstat } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { createDurableFilePromotion } from '../durable-file-promotion.js'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

async function exists(target) {
  try { await access(target); return true } catch { return false }
}

export function normalizeTavernSkillName(value) {
  const name = str(value).trim().normalize('NFC')
  if (!SKILL_NAME.test(name) || name.length > 64) throw new Error('Skill 名称只允许小写字母、数字和连字符，且不能超过 64 个字符')
  return name
}

function renderSkill(input) {
  const description = str(input.description).trim()
  const body = str(input.body).trim()
  if (description === '') throw new Error('Skill 简介不能为空')
  if (description.length > 500) throw new Error('Skill 简介不能超过 500 个字符')
  if (body === '') throw new Error('Skill 正文不能为空')
  if (body.length > 100000) throw new Error('Skill 正文不能超过 100000 个字符')
  const frontmatter = [
    '---',
    'name: ' + input.name,
    'description: ' + JSON.stringify(description),
    ...(input.modelInvocable === false ? ['disable-model-invocation: true'] : []),
    ...(input.userInvocable === false ? ['user-invocable: false'] : []),
    ...(input.purpose ? ['metadata:', '  tavern:', '    purpose: ' + input.purpose] : []),
    '---'
  ]
  return frontmatter.join('\n') + '\n\n' + body + '\n'
}

export function createTavernSkillModule(options = {}) {
  const directory = path.resolve(str(options.directory))
  const builtInDirectory = path.resolve(str(options.builtInDirectory))
  const files = options.files || createDurableFilePromotion(options.filePromotion)
  if (str(options.directory) === '' || str(options.builtInDirectory) === '') throw new Error('Tavern Skill Module 缺少目录')

  function target(root, name) {
    return path.join(root, normalizeTavernSkillName(name), 'SKILL.md')
  }

  const listeners = new Set()
  async function list() {
    const names = new Set()
    for (const root of [builtInDirectory,directory]) {
      let entries; try { entries = await readdir(root,{withFileTypes:true}) } catch(error) { if(error.code==='ENOENT')continue;throw error }
      for(const entry of entries)if(entry.isDirectory()&&SKILL_NAME.test(entry.name))names.add(entry.name)
    }
    const result=[]
    for(const name of [...names].sort()){const skill=await read(name);if(skill)result.push(skill)}
    return result
  }
  async function read(name) {
    const normalized = normalizeTavernSkillName(name)
    for (const source of [
      { kind: 'builtin', path: target(builtInDirectory, normalized) },
      { kind: 'user', path: target(directory, normalized) }
    ]) {
      try {
        if((await lstat(path.dirname(source.path))).isSymbolicLink()||(await lstat(source.path)).isSymbolicLink())throw Error('Skill 入口不能是符号链接')
        const content = await readFile(source.path, 'utf8')
        const match=content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
        const meta=match ? parse(match[1])||{} : {}
        const purpose=meta.metadata?.tavern?.purpose || (normalized.startsWith('tavern-style-')?'writing':'card')
        return { name: normalized, source: source.kind, content, path: source.path, purpose, description:meta.description||'', agents:purpose==='writing'?['card','foreground']:['card'],modelInvocable:meta['disable-model-invocation']!==true,userInvocable:meta['user-invocable']!==false }
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error
      }
    }
    return null
  }

  async function write(input = {}) {
    const name = normalizeTavernSkillName(input.name)
    if (await exists(target(builtInDirectory, name))) throw new Error('内置 Skill 不可覆盖: ' + name)
    const destination = target(directory, name)
    const present = await exists(destination)
    if (present && input.overwrite !== true) throw new Error('Skill 已存在；确认修改后请明确覆盖: ' + name)
    if(input.purpose!==undefined&&!['card','writing'].includes(input.purpose))throw Error('Skill 用途必须是 card 或 writing')
    const previous=present?await read(name):null
    const content = renderSkill({
      purpose:input.purpose??previous?.purpose,
      name,
      description: input.description,
      body: input.body,
      modelInvocable: input.modelInvocable,
      userInvocable: input.userInvocable
    })
    await files.write(destination, content)
    for(const listener of listeners)listener()
    return { name, source: 'user', path: destination, content, chars: content.length, overwritten: present }
  }

  return Object.freeze({ read, write, list, subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener)} })
}

// The ST wire lane has no skill tool loop. Project enabled writing instructions
// into this request only, so disabling a skill cannot leave instructions in history.
export async function compatibilityWritingMessages(library,chat,settings={}) {
 const disabled=new Set(Array.isArray(chat?.disabledWritingSkills)?chat.disabledWritingSkills:settings.defaultDisabledWritingSkills||[]),messages=[];let chars=0
 for(const skill of await library.list()) {
  if(skill.purpose!=='writing'||!skill.modelInvocable||disabled.has(skill.name))continue
  const body=skill.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'').trim()
  chars+=body.length;if(chars>500000)throw Error('启用的写作技能内容过多，请在本局设置中停用部分技能后重试')
  messages.push({role:'system',content:[{type:'text',text:'写作技能 '+skill.name+'：\n'+body}]})
 }
 return messages
}
