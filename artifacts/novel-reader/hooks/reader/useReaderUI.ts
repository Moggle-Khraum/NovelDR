import { useState } from "react";

export function useReaderUI() {
  // Settings & customization panels
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [showBgModal, setShowBgModal] = useState(false);
  const [showFontModal, setShowFontModal] = useState(false);
  const [showTTSSettings, setShowTTSSettings] = useState(false);
  const [showTTSHelp, setShowTTSHelp] = useState(false);

  // Dictionary & glossary
  const [showDictModal, setShowDictModal] = useState(false);
  const [showGlossaryListModal, setShowGlossaryListModal] = useState(false);

  // Navigation
  const [showTOC, setShowTOC] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Warnings & info
  const [showRapidTapWarning, setShowRapidTapWarning] = useState(false);

  // Quick actions panel state
  const [quickActionsExpanded, setQuickActionsExpanded] = useState(true);

  // Convenience toggles
  const toggleSettingsSheet = () => setShowSettingsSheet(!showSettingsSheet);
  const toggleBgModal = () => setShowBgModal(!showBgModal);
  const toggleFontModal = () => setShowFontModal(!showFontModal);
  const toggleTOC = () => setShowTOC(!showTOC);
  const toggleSearch = () => setShowSearch(!showSearch);
  const toggleQuickActions = () =>
    setQuickActionsExpanded(!quickActionsExpanded);

  // Close all panels at once
  const closeAllPanels = () => {
    setShowSettingsSheet(false);
    setShowBgModal(false);
    setShowFontModal(false);
    setShowTOC(false);
    setShowSearch(false);
    setShowTTSSettings(false);
    setShowTTSHelp(false);
  };

  return {
    // Settings panels
    showSettingsSheet,
    setShowSettingsSheet,
    showBgModal,
    setShowBgModal,
    showFontModal,
    setShowFontModal,
    showTTSSettings,
    setShowTTSSettings,
    showTTSHelp,
    setShowTTSHelp,

    // Dictionary & glossary
    showDictModal,
    setShowDictModal,
    showGlossaryListModal,
    setShowGlossaryListModal,

    // Navigation
    showTOC,
    setShowTOC,
    showSearch,
    setShowSearch,

    // Warnings
    showRapidTapWarning,
    setShowRapidTapWarning,

    // Quick actions
    quickActionsExpanded,
    setQuickActionsExpanded,

    // Toggles
    toggleSettingsSheet,
    toggleBgModal,
    toggleFontModal,
    toggleTOC,
    toggleSearch,
    toggleQuickActions,

    // Bulk close
    closeAllPanels,
  };
}
