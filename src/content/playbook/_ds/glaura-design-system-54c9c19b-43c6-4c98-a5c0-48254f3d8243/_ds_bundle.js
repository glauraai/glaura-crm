/* @ds-bundle: {"format":4,"namespace":"GlauraDesignSystem_54c9c1","components":[],"sourceHashes":{"ad_creatives/phone.jsx":"1c47d6322178"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.GlauraDesignSystem_54c9c1 = window.GlauraDesignSystem_54c9c1 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// ad_creatives/phone.jsx
try { (() => {
// Glaura phone mockup — reusable iPhone 14/15 Pro frame
// Renders an iPhone with a notch + Dynamic Island, status bar, and a child app screen
// Sized to fit ad layouts (default 540×1110 inside a 1080×1350 ad).

const PhoneFrame = ({
  width = 540,
  children,
  tilt = 0,
  style = {},
  frameColor = '#1a1a1a',
  noChrome = false
}) => {
  const aspect = 2.06; // iPhone 15 Pro screen aspect (height/width)
  const h = width * aspect;
  const screenInset = width * 0.022;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: width + 'px',
      height: h + 'px',
      background: frameColor,
      borderRadius: width * 0.13 + 'px',
      padding: screenInset + 'px',
      boxSizing: 'border-box',
      boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.08), 0 30px 80px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.25)',
      transform: `rotate(${tilt}deg)`,
      position: 'relative',
      flexShrink: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: '100%',
      background: '#000',
      borderRadius: width * 0.11 + 'px',
      overflow: 'hidden',
      position: 'relative'
    }
  }, !noChrome && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: width * 0.022 + 'px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: width * 0.28 + 'px',
      height: width * 0.065 + 'px',
      background: '#000',
      borderRadius: '999px',
      zIndex: 10
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: width * 0.025 + 'px',
      left: width * 0.06 + 'px',
      right: width * 0.06 + 'px',
      display: 'flex',
      justifyContent: 'space-between',
      color: '#fff',
      fontSize: width * 0.038 + 'px',
      fontWeight: 600,
      fontFamily: '-apple-system, sans-serif',
      zIndex: 11
    }
  }, /*#__PURE__*/React.createElement("span", null, "15:24"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      gap: '6px',
      alignItems: 'center',
      fontSize: width * 0.034 + 'px'
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u2022\u2022\u2022"), /*#__PURE__*/React.createElement("span", null, "\u2022"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: width * 0.038 + 'px'
    }
  }, "\u25AE\u25AE")))), children));
};

// A simulated app screen — vertical video feed view (matches references)
const AppScreenVideo = ({
  scale = 1
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    width: '100%',
    height: '100%',
    background: 'linear-gradient(165deg, #2a1a14 0%, #1a0e0a 60%, #0d0604 100%)',
    position: 'relative',
    overflow: 'hidden'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse at 40% 35%, rgba(220,180,140,0.5) 0%, transparent 55%), radial-gradient(ellipse at 60% 70%, rgba(40,20,15,0.9) 0%, transparent 50%)'
  }
}), /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    inset: '25% 15% 20% 15%',
    background: 'radial-gradient(ellipse, rgba(232,196,158,0.85) 0%, rgba(180,130,90,0.6) 50%, transparent 80%)',
    borderRadius: '40%'
  }
}), /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    top: 60 * scale,
    left: 24 * scale,
    color: '#fff',
    fontSize: 28 * scale,
    fontWeight: 600
  }
}, "\u2039"), /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    top: 60 * scale,
    right: 24 * scale,
    color: '#fff',
    fontSize: 22 * scale
  }
}, "\uD83D\uDD07"), /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    right: 16 * scale,
    bottom: 280 * scale,
    display: 'flex',
    flexDirection: 'column',
    gap: 24 * scale
  }
}, ['♥', '💬', '🔖'].map((i, k) => /*#__PURE__*/React.createElement("div", {
  key: k,
  style: {
    width: 44 * scale,
    height: 44 * scale,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.18)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: 20 * scale
  }
}, i))), /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    bottom: 180 * scale,
    left: 18 * scale,
    right: 90 * scale,
    color: '#fff'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 10 * scale,
    marginBottom: 6 * scale
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    width: 32 * scale,
    height: 32 * scale,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #FFA8C2, #C9A227)'
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontSize: 16 * scale,
    fontWeight: 600
  }
}, "Areej Nail Studio"), /*#__PURE__*/React.createElement("span", {
  style: {
    fontSize: 12 * scale,
    padding: `${4 * scale}px ${10 * scale}px`,
    background: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    fontWeight: 600
  }
}, "Suivre")), /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 14 * scale,
    opacity: 0.9,
    marginBottom: 10 * scale
  }
}, "manucure"), /*#__PURE__*/React.createElement("button", {
  style: {
    background: '#E50050',
    color: '#FFFBF7',
    border: 'none',
    padding: `${10 * scale}px ${20 * scale}px`,
    borderRadius: 999,
    fontSize: 14 * scale,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6 * scale
  }
}, "R\xE9server \u2192")), /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 110 * scale,
    background: '#FFFBF7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTop: `1px solid rgba(0,0,0,0.06)`
  }
}, ['📍', '🛍', '', '💬', '👤'].map((i, k) => k === 2 ? /*#__PURE__*/React.createElement("div", {
  key: k,
  style: {
    width: 56 * scale,
    height: 56 * scale,
    borderRadius: '50%',
    background: '#E50050',
    color: '#FFFBF7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28 * scale,
    fontWeight: 300,
    marginTop: -20 * scale,
    boxShadow: '0 8px 20px rgba(229,0,80,0.35)'
  }
}, "+") : /*#__PURE__*/React.createElement("div", {
  key: k,
  style: {
    fontSize: 22 * scale,
    opacity: 0.6
  }
}, i))));

// Grid feed screen (the categorized grid shown in some refs)
const AppScreenGrid = ({
  scale = 1
}) => {
  const tiles = [{
    bg: 'linear-gradient(135deg, #f4d2a8, #d4a17a)',
    label: 'Maenaails',
    sub: 'Clean french'
  }, {
    bg: 'linear-gradient(135deg, #2a1a12, #4a2a1a)',
    label: 'Krystl Nails',
    sub: 'Nail art'
  }, {
    bg: 'linear-gradient(135deg, #c9a27c, #8b5a3c)',
    label: 'Browlift By Hk',
    sub: 'Brows'
  }, {
    bg: 'linear-gradient(135deg, #1a1a1a, #3a2a2a)',
    label: 'Maenaails',
    sub: 'Gel'
  }, {
    bg: 'linear-gradient(135deg, #d4a890, #8a5a3c)',
    label: 'Studio Léa',
    sub: 'Coiffure'
  }, {
    bg: 'linear-gradient(135deg, #2a2a2a, #4a3a3a)',
    label: 'Aliyah',
    sub: 'Coloration'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: '100%',
      background: '#000',
      position: 'relative',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 50 * scale,
      left: 12 * scale,
      right: 12 * scale,
      display: 'flex',
      gap: 6 * scale,
      alignItems: 'center',
      overflow: 'hidden',
      zIndex: 5
    }
  }, ['Tous', 'Coiffure', 'Nails', 'Makeup', 'Barber'].map((t, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: `${5 * scale}px ${12 * scale}px`,
      background: i === 0 ? '#FFFBF7' : 'rgba(255,255,255,0.85)',
      color: '#2D2D2D',
      borderRadius: 999,
      fontSize: 12 * scale,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      border: i === 0 ? '1px solid #E50050' : 'none'
    }
  }, t)), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 28 * scale,
      height: 28 * scale,
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 14 * scale,
      marginLeft: 'auto',
      flexShrink: 0
    }
  }, "\uD83D\uDD0D")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 92 * scale,
      bottom: 110 * scale,
      left: 6 * scale,
      right: 6 * scale,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 4 * scale
    }
  }, tiles.map((t, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: t.bg,
      borderRadius: 4 * scale,
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      padding: 10 * scale,
      color: '#fff',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13 * scale,
      fontWeight: 600
    }
  }, t.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10 * scale,
      opacity: 0.85
    }
  }, t.sub)))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 110 * scale,
      background: '#FFFBF7',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-around'
    }
  }, ['📍', '🛍', '', '💬', '👤'].map((i, k) => k === 2 ? /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      width: 56 * scale,
      height: 56 * scale,
      borderRadius: '50%',
      background: '#E50050',
      color: '#FFFBF7',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 28 * scale,
      fontWeight: 300,
      marginTop: -20 * scale
    }
  }, "+") : /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      fontSize: 22 * scale,
      opacity: 0.6
    }
  }, i))));
};

// Map screen
const AppScreenMap = ({
  scale = 1
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    width: '100%',
    height: '100%',
    background: '#E8EDE5',
    position: 'relative',
    overflow: 'hidden'
  }
}, /*#__PURE__*/React.createElement("svg", {
  width: "100%",
  height: "100%",
  viewBox: "0 0 540 1110",
  preserveAspectRatio: "xMidYMid slice",
  style: {
    position: 'absolute',
    inset: 0
  }
}, /*#__PURE__*/React.createElement("rect", {
  width: "540",
  height: "1110",
  fill: "#E8EDE5"
}), /*#__PURE__*/React.createElement("path", {
  d: "M 0 300 Q 270 280 540 320",
  stroke: "#fff",
  strokeWidth: "14",
  fill: "none"
}), /*#__PURE__*/React.createElement("path", {
  d: "M 100 0 Q 200 555 80 1110",
  stroke: "#fff",
  strokeWidth: "14",
  fill: "none"
}), /*#__PURE__*/React.createElement("path", {
  d: "M 0 600 L 540 580",
  stroke: "#fff",
  strokeWidth: "10",
  fill: "none"
}), /*#__PURE__*/React.createElement("path", {
  d: "M 0 800 Q 270 820 540 770",
  stroke: "#fff",
  strokeWidth: "12",
  fill: "none"
}), /*#__PURE__*/React.createElement("path", {
  d: "M 380 0 Q 320 555 420 1110",
  stroke: "#fff",
  strokeWidth: "10",
  fill: "none"
}), /*#__PURE__*/React.createElement("path", {
  d: "M 0 700 Q 270 760 540 690 L 540 760 Q 270 820 0 760 Z",
  fill: "#B8D4E8",
  opacity: "0.5"
}), /*#__PURE__*/React.createElement("ellipse", {
  cx: "430",
  cy: "450",
  rx: "80",
  ry: "60",
  fill: "#C8DDB8",
  opacity: "0.7"
}), [[180, 750], [220, 780], [260, 760], [300, 790], [200, 820], [250, 850], [150, 700], [320, 720], [350, 800], [280, 880], [180, 900], [380, 830], [120, 820], [220, 920], [300, 950], [260, 980], [400, 900], [340, 1000], [200, 1000], [280, 760], [380, 760], [160, 600], [280, 620], [380, 580]].map(([x, y], i) => /*#__PURE__*/React.createElement("g", {
  key: i,
  transform: `translate(${x},${y})`
}, /*#__PURE__*/React.createElement("path", {
  d: "M 0 -22 C -10 -22 -16 -14 -16 -6 C -16 8 0 22 0 22 C 0 22 16 8 16 -6 C 16 -14 10 -22 0 -22 Z",
  fill: "#E50050"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "0",
  cy: "-6",
  r: "5",
  fill: "#FFFBF7"
})))), /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    top: 88 * scale,
    left: 16 * scale,
    right: 16 * scale,
    background: '#FFFBF7',
    borderRadius: 14,
    padding: `${12 * scale}px ${16 * scale}px`,
    display: 'flex',
    alignItems: 'center',
    gap: 10 * scale,
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    color: '#E50050',
    fontSize: 16 * scale
  }
}, "\uD83D\uDD0D"), /*#__PURE__*/React.createElement("span", {
  style: {
    fontSize: 13 * scale,
    color: '#888'
  }
}, "Recherche par salon ou prestation")), /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    top: 144 * scale,
    left: 16 * scale,
    right: 60 * scale,
    display: 'flex',
    gap: 6 * scale
  }
}, ['Tous', 'Coiffure', 'Nails', 'Makeup', 'Barber'].map((t, i) => /*#__PURE__*/React.createElement("div", {
  key: i,
  style: {
    padding: `${5 * scale}px ${12 * scale}px`,
    background: '#FFFBF7',
    color: '#2D2D2D',
    borderRadius: 999,
    fontSize: 12 * scale,
    fontWeight: 600,
    border: i === 0 ? '1px solid #E50050' : '1px solid rgba(0,0,0,0.08)'
  }
}, t))), /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    top: 144 * scale,
    right: 12 * scale,
    width: 36 * scale,
    height: 36 * scale,
    borderRadius: '50%',
    background: '#FFFBF7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    fontSize: 16 * scale
  }
}, "\u25CE"));
window.PhoneFrame = PhoneFrame;
window.AppScreenVideo = AppScreenVideo;
window.AppScreenGrid = AppScreenGrid;
window.AppScreenMap = AppScreenMap;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ad_creatives/phone.jsx", error: String((e && e.message) || e) }); }

})();
