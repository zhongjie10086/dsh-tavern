// Rows are scalar arrays. Tag numbers to preserve -0, NaN and infinity semantics.
const rowKey=(sheet,row)=>JSON.stringify([sheet,row.map(cell=>[typeof cell,typeof cell==='number'?Object.is(cell,-0)?'-0':String(cell):cell])])
export function createSpArchiveIndex(archives=[]) {
 const keys=new Set(archives.map(item=>rowKey(item.sheet,item.row)))
 return {has:(sheet,row)=>keys.has(rowKey(sheet,row))}
}
