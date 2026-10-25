function createTavernVisibleSidebarTab(type, title) {
  return function (state) {
    function leaves(node) { return !node ? [] : node.kind === 'leaf' ? [node] : (node.children || []).flatMap(leaves); }
    const right=leaves(state.splits),bottom=leaves(state.bottomSplits),panes=right.concat(bottom);
    const existingPane=panes.find(pane=>pane.tabs.some(tab=>tab.type===type));
    const floating=(state.floats||[]).find(frame=>frame.tab.type===type);
    // The service focuses/raises existing tabs. Return their complete object so
    // library navigation metadata, saved titles and floating geometry survive.
    if(!existingPane&&floating)return {tab:floating.tab};
    const target=existingPane||panes.find(pane=>pane.id===state.activePane)||right[0];
    const tab=existingPane?existingPane.tabs.find(tab=>tab.type===type):{id:type,type,title};
    const inBottom=bottom.includes(target);
    // Sidebar's <768px layout merges both pane trees into one right drawer.
    const narrow=typeof window!=='undefined'&&window.innerWidth<768;
    const patch=narrow?{panelOpen:true}:inBottom?{bottomOpen:true,bottomOpenedOnce:true}:{panelOpen:true};
    return {tab,patch};
  };
}
function openTavernSidebarShortcut(sidebar,type,props) {
  const sessionId=props?.scope?.sessionId||props?.sessionId;
  // An explicit scope with an undefined id is classified as an INACTIVE
  // session by the native service; omit it to target the current viewer.
  if(typeof sessionId==='string'&&sessionId)sidebar.openTab({type},{...props?.scope,sessionId});
  else sidebar.openTab({type});
}
