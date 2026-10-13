module.exports = function(source) {
  if (!source.includes('async function showEditor(ref: string)')) throw new Error('Pinned template editor entry changed')
  return source + '\nexport function getTemplateEditors() { return monaco?.editor?.getEditors?.() || []; }\nexport async function openTemplateCodeEditor(ref: string) { await setupEditor(); return await showEditor(ref); }\n'
}
