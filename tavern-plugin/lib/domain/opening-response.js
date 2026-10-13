/** Share common preparation data once on the wire; old clients keep their existing response. */
export function compactOpeningResponse(response,version){
  if(version!==2)return response
  const previews=(response.openings||[]).filter(o=>o.openingPreview).map(o=>o.openingPreview)
  if(!previews.length)return {...response,openingDataVersion:2}
  const shared={}
  for(const key of ['swipes','openingIds','assetAccess','preparationId','worldbook','characterName','runtime']){
    if(Object.hasOwn(previews[0],key)&&previews.every(p=>p[key]===previews[0][key]))shared[key]=previews[0][key]
  }
  return {...response,openingDataVersion:2,openingShared:shared,openings:response.openings.map(opening=>{
    if(!opening.openingPreview)return opening
    const preview={...opening.openingPreview}
    for(const key of Object.keys(shared))delete preview[key]
    return {...opening,openingPreview:preview}
  })}
}
