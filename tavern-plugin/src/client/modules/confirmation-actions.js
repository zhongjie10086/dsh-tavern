async function confirmTavernAction(args, services) {
  const call = services.rpc, confirm = services.confirm;
  const preview = await call("getTavernConfirmationPreview", args);
  const description = preview.action === "profile-confirm"
    ? "确认保存画像《" + preview.name + "》？\n\n" + String(preview.draft.summary || "") + "\n\n实际注入摘要：\n" + String(preview.draft.injectionText || "")
    : "将人物卡《" + preview.name + "》（" + preview.target + "）从原版整体恢复？\n这会覆盖当前工作版的全部修改，恢复前会验证并保留备份。";
  if (!await confirm(description)) return null;
  const scope = Object.assign({}, args, { expectedRevision: preview.revision });
  const approval = await call("issueTavernConfirmation", scope);
  return call("executeTavernConfirmation", Object.assign({}, scope, { approvalToken: approval.approvalToken }));
}
