function projectTavernScriptContext(value, scriptIds, policy = {}, copy = true) {
  const context = value ? (copy ? JSON.parse(JSON.stringify(value)) : {...value}) : {};
  if(value?.extensionSettings&&Object.hasOwn(value.extensionSettings,'regex'))context.extensionSettings={...context.extensionSettings,regex:JSON.parse(JSON.stringify(value.extensionSettings.regex))};
  if(value?.regexScripts&&Object.hasOwn(value.regexScripts,'global'))context.regexScripts={...context.regexScripts,global:JSON.parse(JSON.stringify(value.regexScripts.global))};
  const grants = new Set(policy.capabilities || []), ids = new Set(scriptIds);
  function own(values) { return Object.fromEntries(Object.entries(values || {}).filter(([key]) => ids.has(key))); }
  if (!grants.has('shared-settings')) {
    context.globalVariables = {};
    const readable = new Set([...ids,'regex','tavern_helper','EjsTemplate','SPreset',...(policy.namespaces || []),...(ids.has('__dsh_official_mvu__')?['mvu_settings']:[])]);
    context.extensionSettings = Object.fromEntries(Object.entries(context.extensionSettings || {}).filter(([key])=>readable.has(key)));
    const storage = own(value?.extensionSettings?.__userscripts);
    if (Object.keys(storage).length) context.extensionSettings.__userscripts = storage;
  }
  if (typeof context.mvuExtraAnalysis === 'boolean') context.globalVariables = {...context.globalVariables,extra_analysis:context.mvuExtraAnalysis};
  context.scriptVariables = own(context.scriptVariables);
  context.scriptStorage = own(context.scriptStorage);
  if (!grants.has('shared-resources')) {
    delete context.scriptTreesDigest; delete context.scriptTrees;
  }
  if (context.openingHost) context.openingHost = {...context.openingHost,extensionSettings:context.extensionSettings};
  return context;
}

function assertTavernFrameSlash(line, trusted) {
  if(trusted)return;
  const source=String(line || '').trim();
  // Split pipelines outside quoted/escaped arguments, so /echo "/run" is text.
  let segment='',quote='',escaped=false;const segments=[];
  for(const char of source){if(escaped){segment+=char;escaped=false;continue;}if(char==='\\'){segment+=char;escaped=true;continue;}if(quote){segment+=char;if(char===quote)quote='';continue;}if(char==='"'||char==="'"){quote=char;segment+=char;continue;}if(char==='|'){segments.push(segment);segment='';}else segment+=char;}
  segments.push(segment);
  for(const value of segments){const command=value.trim().match(/^\/([^\s]+)/)?.[1]?.toLowerCase() || '';
    if(/^(?:run|js|qr.*|import.*|api.*|model|preset|gen(?:raw)?|sys|sendas|setglobalvar|flushglobalvar|settings?|profile|deletechat|delchat|char|newchat)$/.test(command))throw Error('此命令需要资源授信，请在资源授信面板一次性设置');
  }
}

// Both records are owned by the host. Never accept permissions or MVU identity
// from the event payload. Lower-privilege observers cannot change the sender.
function tavernEventRelayAccess(source, target) {
  const grants = record => new Set([...(record.policy?.capabilities || []), ...(record.trustedCardMode ? ['same-origin'] : [])]);
  const from = grants(source), to = grants(target);
  const covers = [...to].every(value => from.has(value));
  const same = covers && [...from].every(value => to.has(value));
  if (source.officialMvu) return { deliver: true, mutable: !!(target.officialMvu || target.trustedCardMode) };
  if (target.officialMvu) return { deliver: !!source.trustedCardMode, mutable: !!source.trustedCardMode };
  return { deliver: covers, mutable: same };
}

function projectTavernScriptResult(result,scriptIds,policy) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const output=Object.assign({},result);
  if(output.context)output.context=projectTavernScriptContext(output.context,scriptIds,policy);
  const fields=['extensionSettings','globalVariables','scriptVariables','scriptStorage','scriptTrees','scriptTreesDigest','worldbookLibrary'];
  if(fields.some(key=>Object.prototype.hasOwnProperty.call(result,key))) {
    const scoped=projectTavernScriptContext(Object.fromEntries(fields.filter(key=>Object.prototype.hasOwnProperty.call(result,key)).map(key=>[key,result[key]])),scriptIds,policy);
    for(const key of fields)if(Object.prototype.hasOwnProperty.call(result,key)){if(Object.prototype.hasOwnProperty.call(scoped,key))output[key]=scoped[key];else delete output[key]}
  }
  return output;
}

function tavernFrameCsp(input = {}) {
  const network = input.trustedCardMode === true || input.networkAllowed === true;
  const origin = typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null' ? window.location.origin : '';
  const shipped = origin ? origin + '/api/dsh-tavern/vendor/ ' + origin + '/api/dsh-tavern/client-assets/' : "'self'";
  const assets = input.assetAccess?.prefix && origin ? ' '+origin+input.assetAccess.prefix : '';
  const remote = network ? 'https: http:' : shipped+assets;
  return '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' data: blob: ' + remote + '; connect-src data: blob: ' + remote + (network ? ' ws: wss:' : '') + '; img-src data: blob: ' + remote + '; media-src data: blob: ' + remote + '; style-src \'unsafe-inline\' data: blob: ' + remote + '; font-src data: ' + remote + '; frame-src data: blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">';
}
