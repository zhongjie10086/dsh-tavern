// Browser template work is isolated in a disposable page and terminated by
// full-prompt-template-executor's external deadline. Node's vm is unavailable.
export const REGEX_LIMITS=Object.freeze({timeoutMs:50,inputChars:2*1024*1024,outputChars:8*1024*1024,patternChars:32768})
export function withRegexBudget(perform){return perform()}
