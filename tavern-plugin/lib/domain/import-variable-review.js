// Inspect saved data, never infer a purpose from a name or execute imported code.
function paths(value, path = []) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length && path.length < 8)
    return Object.keys(value).flatMap(key => paths(value[key], path.concat(key)))
  return path.length ? [{path, valueType: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value}] : []
}
export function inspectImportedVariables(document, scope) {
  const raw = document?.kind === 'dsh-tavern-character-workspace' ? document.raw : document
  const data = /^chara_card_v[23]$/.test(raw?.spec) ? raw.data : raw
  const helper = data?.extensions?.tavern_helper || data?.extension_settings?.tavern_helper || {}
  const scripts = Array.isArray(data) ? data : ['script','folder'].includes(data?.type) ? [data] : data?.scripts || helper.scripts || helper.script?.scripts || []
  const rows = []
  function visit(items) {
    for (const script of Array.isArray(items) ? items : []) {
      if (Array.isArray(script?.scripts)) { visit(script.scripts); continue }
      for (const field of paths(script?.data)) rows.push({...field, scriptId:script.id || '', scriptName:script.name || '未命名脚本', source:scope+' · 脚本 data 初值', purpose:'', authorDeclaration:''})
    }
  }
  visit(scripts)
  for (const key of Object.keys(helper.variables || {})) rows.push({path:[key],scriptName:scope,source:scope+' · 变量初值',purpose:'',authorDeclaration:''})
  return {unknown:rows.length, rows, notice:'新资源按其 API 作用域运行，script 变量默认共享；旧未知数据保持原位。用途未确定，导入和运行不受影响。开始游玩后可在“扩展程序 → 酒馆助手 → 脚本管理 → 变量用途与归属”集中查看并保存选择。'}
}
