function createTavernDatabaseBridge(options) {
  const win = options.window, call = options.call, context = options.context;
  let snapshot = context().database || { revision: 0, data: {}, schema: [] }, database = null, SQL = null, notifying = false;
  let sqlCode = null, disposed = false;
  const contentRevision=value=>value?.dataRevision??JSON.stringify([value?.data||{},value?.schema||[]]);
  let dataRevision=contentRevision(snapshot),builtRevision=null;
  const currentScope=()=>JSON.stringify([context().chatId,context().lifecycleRevision]);
  let scope=currentScope();
  const callbacks = new Set(), fillCallbacks = new Set(), pending = new Set();
  const copy = value => JSON.parse(JSON.stringify(value)), quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  function sync(next,sourceScope) {
    const nextScope=currentScope();
    if(sourceScope!==undefined&&sourceScope!==nextScope)return false;
    if(scope===nextScope&&next&&Number.isSafeInteger(next.revision)&&Number.isSafeInteger(snapshot.revision)&&next.revision<snapshot.revision)return false;
    if(scope!==nextScope)builtRevision=null;
    scope=nextScope;
    if (!next) {snapshot={revision:-1,data:{},schema:[]};dataRevision=contentRevision(snapshot);builtRevision=null;database?.close();database=null;return false;}
    if (next.activity?.status === 'running' && (snapshot.activity?.status !== 'running' || next.activity.startedAt !== snapshot.activity.startedAt)) {
      for (const fn of fillCallbacks) { try { fn(copy(next.activity)); } catch (e) { win.console.error(e); } }
    }
    const revision=contentRevision(next),changed=revision!==dataRevision;
    snapshot = copy(next);
    dataRevision=revision;return changed;
  }
  function ensureDatabase(){
    if(disposed)throw new Error('数据库窗口已释放');
    if(!SQL && sqlCode){
      // The original SP API returns rows synchronously. Instantiate the shipped
      // module synchronously on first use instead of making that API async.
      let initializationError;
      const configuration={instantiateWasm(imports,receive){
        try{const module=new win.WebAssembly.Module(sqlCode),instance=new win.WebAssembly.Instance(module,imports);receive(instance,module);return instance.exports;}
        catch(error){initializationError=error;throw error;}
      },postRun:[function(){SQL=configuration;}]};
      win.initSqlJs(configuration).catch(error=>win.console.error(error));
      if(!SQL)throw initializationError||new Error('当前 SQLite 版本未能同步初始化');
      sqlCode=null;
    }
    if(!SQL)throw new Error('SQL 运行时尚未就绪');
    if(database&&builtRevision===dataRevision)return;
    const previous = database; database = new SQL.Database();
    try {
      for (const table of snapshot.schema || []) {
        database.run(table.ddl);
        const statement = database.prepare('INSERT INTO ' + quote(table.name) + ' VALUES (' + table.columns.map(() => '?').join(',') + ')');
        try { for (const row of snapshot.data[table.key].content.slice(1)) statement.run(row.map(cell => typeof cell === 'boolean' ? Number(cell) : cell)); } finally { statement.free(); }
      }
      database.run('PRAGMA query_only=ON');
    } catch (e) { database.close(); database = previous; throw e; }
    previous?.close();
    builtRevision=dataRevision;
  }
  function notify() {
    if (notifying) return;
    notifying = true;
    try { for (const fn of callbacks) { try { fn(copy(snapshot.data), { persisted: true }); } catch (e) { win.console.error(e); } } } finally { notifying = false; }
  }
  function tableOf(name) {
    const matches = (snapshot.schema || []).filter(t => [t.key, t.name, snapshot.data[t.key].name, snapshot.data[t.key].uid].includes(name));
    if (matches.length !== 1) throw new Error('表格不存在或名称冲突：' + name);
    return matches[0];
  }
  function columnOf(table, name) {
    let index = table.columns.indexOf(name);
    if (index < 0) index = snapshot.data[table.key].content[0].indexOf(name);
    if (index < 0) throw new Error('列不存在：' + name);
    return table.columns[index];
  }
  function querySql(sqlOrOptions, params) {
    ensureDatabase();
    const sql = typeof sqlOrOptions === 'object' ? sqlOrOptions.sql : sqlOrOptions;
    params = typeof sqlOrOptions === 'object' ? sqlOrOptions.params : params;
    if (/^\s*PRAGMA\b/i.test(sql) && !/^\s*PRAGMA\s+(table_info|table_xinfo|index_list|index_info|foreign_key_list)\s*\([^;=]+\)\s*;?\s*$/i.test(sql)) throw new Error('仅支持只读结构查询');
    if (!/^\s*(SELECT|WITH|EXPLAIN|PRAGMA)\b/i.test(sql)) throw new Error('仅支持只读 SQL 查询');
    const statement = database.prepare(sql);
    try {
      if (params) statement.bind(params);
      const rows = [], columns = statement.getColumnNames(), values = [];
      while (statement.step() && rows.length < 2000) { rows.push(statement.getAsObject()); values.push(statement.get()); }
      return { columns, rows, values, rowCount: rows.length, sql, limited: rows.length === 2000 };
    } finally { statement.free(); }
  }
  function queryTableRows(input = {}) {
    const table = tableOf(input.sheetKey || input.tableName || input.table);
    const columns = input.columns?.length ? input.columns : ['*'], params = [], clauses = [];
    for (const [key, value] of Object.entries(input.where || {})) {
      const name = quote(columnOf(table, key));
      if (Array.isArray(value)) { clauses.push(value.length ? name + ' IN (' + value.map(() => '?').join(',') + ')' : '1=0'); params.push(...value); }
      else if (value == null) clauses.push(name + ' IS NULL');
      else { clauses.push(name + ' = ?'); params.push(value); }
    }
    const orders = input.orderBy || input.order, list = orders ? Array.isArray(orders) ? orders : [orders] : [];
    const ordering = list.map(o => quote(columnOf(table, typeof o === 'string' ? o : o.column)) + (o.direction === 'DESC' ? ' DESC' : ' ASC')).join(',');
    const limit = Math.max(0, Math.min(2000, Number(input.limit ?? 100))), offset = Math.max(0, Number(input.offset || 0));
    if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset)) throw new Error('分页参数无效');
    return querySql('SELECT ' + columns.map(c => c === '*' ? '*' : quote(columnOf(table, c))).join(',') + ' FROM ' + quote(table.name)
      + (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '') + (ordering ? ' ORDER BY ' + ordering : '') + ' LIMIT ' + limit + ' OFFSET ' + offset, params);
  }
  async function commit(command) {
    const sourceScope=currentScope();
    const task = command.kind === 'fill' ? call('fillTavernScriptDatabase', {}) : call('commitTavernScriptDatabase', { command, expectedRevision: snapshot.revision });
    pending.add(task);
    try {
      const result = await task; const changed = sync(result.database,sourceScope); if (changed) notify();
      return { success: true, saved: true, changes: result.changes, errors: [] };
    } finally { pending.delete(task); }
  }
  function operation(kind, tableName, rowIndex, values, column) {
    const table = tableOf(tableName), row = snapshot.data[table.key].content[Number(rowIndex)];
    if (kind !== 'insert' && (!row || Number(rowIndex) < 1)) throw new Error('数据库行不存在');
    if (kind === 'cell' && typeof column !== 'number') column = table.columns.indexOf(columnOf(table, column));
    if (values && typeof values === 'object' && !Array.isArray(values)) values = Object.fromEntries(Object.entries(values).map(([key, value]) => [snapshot.data[table.key].content[0][table.columns.indexOf(columnOf(table, key))], value]));
    return commit({ kind: 'operations', operations: [{ kind, sheet: table.key, ...(row ? { rowId: row[0] } : {}), ...(kind === 'cell' ? { column, value: values } : { values }) }] }).then(r => r.success);
  }
  let templateNames=[];
  async function templateCommand(operation){const sourceScope=currentScope(),result=await call('tavernHelperDatabaseTemplates',{operation,expectedRevision:snapshot.revision});if(sourceScope!==currentScope())return result;if(result.names)templateNames=result.names;if(result.database){const changed=sync(result.database,sourceScope);if(changed)notify()}return result}
  const api = {
    getTemplatePresetNames:()=>Array.isArray(context().originalDatabaseTemplates)?context().originalDatabaseTemplates.slice():templateNames.slice(),
    importTemplateFromData:(data,options={})=>templateCommand({kind:'import',data,scope:options.scope||'global',name:options.presetName,dataMode:options.dataMode,conflictPolicy:options.conflictPolicy}),
    switchTemplatePreset:(name,options={})=>templateCommand({kind:'select',scope:options.scope||'global',name}),
    exportFullCheckpointAtMessageIndex: messageIndex => call('tavernHelperChatFiles',{operation:{path:'checkpoint',body:{messageIndex}}}).then(result=>result.value),
    exportTableAsJson: () => copy(snapshot.data), getTableData: () => copy(snapshot.data),
    importTableAsJson: (value, options) => commit({ kind: 'replace', ...(options?.source==='sp-mirror'?{source:'sp-mirror'}:{}), data: typeof value === 'string' ? JSON.parse(value) : copy(value) }).then(result => result.success),
    manualUpdate: () => commit({ kind: 'fill' }),
    openVisualizer: () => { if (!options.openVisualizer) throw new Error('数据库界面尚未连接'); return options.openVisualizer(); },
    registerTableFillStartCallback: fn => fillCallbacks.add(fn), unregisterTableFillStartCallback: fn => fillCallbacks.delete(fn),
    querySql, executeSqlQuery: querySql, queryTableRows,
    executeSqlMutation: (sql, params) => commit({ kind: 'sql', sql: typeof sql === 'object' ? sql.sql : sql, parameters: typeof sql === 'object' ? sql.params || [] : params || [] }),
    executeSqlBatch: sql => commit({ kind: 'sql', sql: typeof sql === 'object' ? sql.sql : sql, parameters: [] }),
    updateCell: (table, row, column, value) => typeof table === 'object'
      ? operation('cell', table.tableName || table.sheetKey, table.rowIndex, table.value, table.colIdentifier || table.column)
      : operation('cell', table, row, value, column),
    updateRow: (table, row, values) => typeof table === 'object' ? operation('update', table.tableName || table.table || table.sheetName || table.sheetKey, table.rowIndex ?? table.row ?? table.index, table.data || table.values || table.rowData) : operation('update', table, row, values),
    insertRow: (table, values) => typeof table === 'object' ? operation('insert', table.tableName || table.table || table.sheetName || table.sheetKey, null, table.data || table.values || table.rowData) : operation('insert', table, null, values),
    deleteRow: (table, row) => typeof table === 'object' ? operation('delete', table.tableName || table.table || table.sheetName || table.sheetKey, table.rowIndex ?? table.row ?? table.index) : operation('delete', table, row),
    registerTableUpdateCallback: fn => callbacks.add(fn), unregisterTableUpdateCallback: fn => callbacks.delete(fn),
    _notifyTableUpdate: notify, hasPendingSaves: () => pending.size > 0, flushPendingSaves: () => Promise.all([...pending]),
    _dshSnapshot:()=>copy(snapshot), getConfig: () => copy(snapshot.settings || {}), getVersion: () => 'DSH-SP-compat/1.0'
  };
  win.AutoCardUpdaterAPI = api;
  let loading=null;
  function ensureSql(){
    if(SQL||sqlCode||disposed)return Promise.resolve();if(loading)return loading;
    const scriptReady=new Promise((resolve,reject)=>{const script=win.document.createElement('script');script.src='/api/dsh-tavern/client-assets/sql-wasm.js';script.onload=()=>{
      // Cards may call the public factory first. Observe its result without
      // changing their options, so the bridge can reuse that frame's runtime.
      const initialize=win.initSqlJs,observed=new WeakMap();
      win.initSqlJs=function(configuration){const pending=initialize.call(this,configuration);if(!observed.has(pending))observed.set(pending,pending.then(module=>{if(!disposed){SQL=module;sqlCode=null;}return module}));return observed.get(pending)};
      resolve();
    };script.onerror=()=>reject(new Error('本地 SQLite 脚本加载失败'));win.document.head.appendChild(script)});
    loading=typeof options.loadSqlCode==='function'
      ? Promise.all([scriptReady,options.loadSqlCode()]).then(([,bytes])=>{if(!bytes||!Number.isSafeInteger(bytes.byteLength)||bytes.byteLength===0)throw new Error('本地 SQLite 代码无效');if(!disposed)sqlCode=bytes;})
      : scriptReady.then(async()=>{if(!disposed)SQL=await win.initSqlJs({locateFile:()=>new URL('/api/dsh-tavern/client-assets/sql-wasm.wasm',win.document.baseURI).href});});
    loading=loading.finally(()=>{loading=null});return loading;
  }
  const ready=context().database?Promise.all([ensureSql(),templateCommand({kind:'list',bootstrap:true})]):Promise.resolve();
  win.addEventListener('pagehide', () => { disposed=true;sqlCode=null;database?.close(); database = null; builtRevision=null;callbacks.clear();fillCallbacks.clear(); }, { once: true });
  return { ready, sync(next) { const changed=sync(next);if(next&&!SQL)void ensureSql().catch(e=>win.console.error(e));if(changed)notify(); } };
}
