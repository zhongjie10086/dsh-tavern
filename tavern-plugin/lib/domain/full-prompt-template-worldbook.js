/** Translate normalized native entries without losing identity or original ordering fields. */
export function projectTemplateWorldbookEntries(worldBook) {
 const world=worldBook?.view?.displayName||'current'
 return (worldBook?.view?.entries||[]).map(entry=>({...entry,world,uid:entry.sourceUid??entry.ref,key:entry.primaryKeys||[],keysecondary:entry.secondaryKeys||[],comment:entry.comment||entry.title||'',disable:entry.enabled===false}))
}
export function restoreTemplateWorldbookEntries(entries) {
 return entries.map(entry=>({...entry,enabled:entry.disable!==true,sourceUid:entry.uid,primaryKeys:entry.key||[],secondaryKeys:entry.keysecondary||[]}))
}
