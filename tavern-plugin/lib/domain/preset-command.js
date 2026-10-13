/** Human command only. Reuse the same revision/busy/lifecycle transaction as the UI. */
export function createPresetCommand({ dispatch }) {
  return {
    name: 'preset',
    description: '查看或切换本局预设（共享预设的更新仍自动跟随）',
    input: { hint: '[status|list|use 名称或路径|default|off]' },
    async handler(invocation) {
      const raw = invocation.rawInput.trim(), sessionId = invocation.agent.session.id
      const match = /^(status|list|default|off|use)(?:\s+([\s\S]+))?$/i.exec(raw || 'status')
      if (!match || (match[1].toLowerCase() === 'use') !== Boolean(match[2]?.trim())) return { kind: 'error', text: '用法：/preset status | list | use 名称或路径 | default | off' }
      try {
        const action = match[1].toLowerCase()
        const { controls } = await dispatch('getGamePresetControls', { sessionId })
        if (action === 'status') return { kind: 'success', text: `本局预设：${controls.name}；${controls.resourceMode === 'follow' ? '跟随共享版本' : '固定版本'}；${controls.scope === 'local' ? '存在显式本局覆盖' : '使用共享条目设置'}。` }
        const catalog = await dispatch('listPresets', {})
        const choices = catalog.presets.filter(item => item.valid && item.recognized)
        if (action === 'list') return { kind: 'success', text: choices.length ? choices.map(item => `${item.title} — ${item.path}`).join('\n') : '预设库为空。可在资源管理中导入预设。' }
        let path = action === 'default' ? catalog.activePresetPath : ''
        if (action === 'use') {
          const query = match[2].trim()
          const matches = choices.filter(item => item.path === query || item.title === query)
          if (matches.length !== 1) return { kind: 'error', text: matches.length ? '有多个同名预设，请用 /preset list 查看并指定完整路径。' : '找不到该预设。请用 /preset list 查看名称和路径。' }
          path = matches[0].path
        }
        const result = await dispatch('applyConversationPreset', { sessionId, path: path || '' })
        return { kind: 'success', text: `本局已${result.runtimePreset?.id ? '切换为：' + result.runtimePreset.name + '（跟随共享更新）' : '停用外部预设，使用内置设置'}。其他游戏及新局默认选择保持各自设置。` }
      } catch (error) {
        return { kind: 'error', text: String(error?.message || error) }
      }
    }
  }
}
