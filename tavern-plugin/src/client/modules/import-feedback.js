function tavernImportWarnings(result) {
  return (result?.importWarnings || result?.card?.importWarnings || result?.preset?.importWarnings || [])
    .filter(row => row && typeof row.message === 'string').map(row => row.message);
}

function TavernImportFeedback(props) {
  const warnings = tavernImportWarnings(props.result);
  const review=props.result?.variableReview||props.result?.card?.variableReview||props.result?.preset?.variableReview;
  if (!warnings.length&&!review?.unknown) return null;
  const h = React.createElement;
  return h('section', {role:'status', 'aria-label':'导入提示'},
    h('p',null,'已导入，以下内容请留意：'),
    warnings.length?h('ul',null,warnings.map((message,index)=>h('li',{key:index},message))):null,
    review?.unknown?h('details',{'aria-label':'导入变量用途'},h('summary',null,'有 '+review.unknown+' 项变量用途未确定，可稍后处理'),h('p',null,review.notice),h('ul',null,review.rows.map((row,index)=>h('li',{key:index},row.scriptName+' · '+row.path.join('.')+' · '+row.source+' · 用途：'+row.purpose+' · 作者声明：'+row.authorDeclaration)))):null);
}
