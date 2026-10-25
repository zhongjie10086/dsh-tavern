// This policy controls message HTML creation, never the complete Helper history
// or the separately owned card/extension script runtime.
function tavernMessageHtmlIsAutomatic(input) {
    if (input.legacyAutomatic === true || input.streaming === true || input.openingPreview
        || input.persistent === true || input.preserveInstance === true || input.pinned === true) return true;
    const turn = Number(input.turn);
    // Established games map greeting messages to their actual story turn (often
    // one). Only server-identified greetings are exempt, never arbitrary turn 1.
    if ((input.openingStoryTurns || []).includes(turn)) return true;
    return (input.recentStoryTurns || []).includes(turn);
}

function TavernMessageHtmlGate(props) {
    const [expanded, setExpanded] = React.useState(false);
    const automatic = tavernMessageHtmlIsAutomatic(props);
    // Once admitted, the existing frame lifecycle owns it. Moving outside the
    // recent window must not unmount an interactive or SP-held document.
    const admitted = React.useRef(false);
    if (automatic || expanded) admitted.current = true;
    if (admitted.current) return React.createElement(TavernMessageFrame, {
        ...props.frameProps,
        // Compatibility restores the existing viewport-based activation rather
        // than eagerly mounting every historical iframe at once.
        eager: expanded || props.streaming === true || Boolean(props.openingPreview) || (props.openingStoryTurns || []).includes(Number(props.turn)) || props.frameProps.eager === true,
        manualActivationOnly: !automatic
    });
    return React.createElement('button', {
        type: 'button', className: 'dsh-tavern-btn',
        'data-dsh-tavern-older-html': true,
        onClick: () => setExpanded(true)
    }, '展开并运行此轮 HTML');
}
