// Version 2.6.0 react-kapsule - https://github.com/vasturiano/react-kapsule
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory(require('react')) :
  typeof define === 'function' && define.amd ? define(['react'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.fromKapsule = factory(global.React));
})(this, (function (React) { 'use strict';

  function _iterableToArrayLimit(arr, i) {
    var _i = null == arr ? null : "undefined" != typeof Symbol && arr[Symbol.iterator] || arr["@@iterator"];
    if (null != _i) {
      var _s,
        _e,
        _x,
        _r,
        _arr = [],
        _n = true,
        _d = false;
      try {
        if (_x = (_i = _i.call(arr)).next, 0 === i) {
          if (Object(_i) !== _i) return;
          _n = !1;
        } else for (; !(_n = (_s = _x.call(_i)).done) && (_arr.push(_s.value), _arr.length !== i); _n = !0);
      } catch (err) {
        _d = true, _e = err;
      } finally {
        try {
          if (!_n && null != _i.return && (_r = _i.return(), Object(_r) !== _r)) return;
        } finally {
          if (_d) throw _e;
        }
      }
      return _arr;
    }
  }
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value: value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _slicedToArray(arr, i) {
    return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest();
  }
  function _toConsumableArray(arr) {
    return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
  }
  function _arrayWithoutHoles(arr) {
    if (Array.isArray(arr)) return _arrayLikeToArray(arr);
  }
  function _arrayWithHoles(arr) {
    if (Array.isArray(arr)) return arr;
  }
  function _iterableToArray(iter) {
    if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
  }
  function _unsupportedIterableToArray(o, minLen) {
    if (!o) return;
    if (typeof o === "string") return _arrayLikeToArray(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor) n = o.constructor.name;
    if (n === "Map" || n === "Set") return Array.from(o);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
  }
  function _arrayLikeToArray(arr, len) {
    if (len == null || len > arr.length) len = arr.length;
    for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];
    return arr2;
  }
  function _nonIterableSpread() {
    throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  function _nonIterableRest() {
    throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  function _toPrimitive(input, hint) {
    if (typeof input !== "object" || input === null) return input;
    var prim = input[Symbol.toPrimitive];
    if (prim !== undefined) {
      var res = prim.call(input, hint);
      if (typeof res !== "object") return res;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (hint === "string" ? String : Number)(input);
  }
  function _toPropertyKey(arg) {
    var key = _toPrimitive(arg, "string");
    return typeof key === "symbol" ? key : String(key);
  }
  var omit = function omit(obj, keys) {
    var keySet = new Set(keys);
    return Object.assign.apply(Object, [{}].concat(_toConsumableArray(Object.entries(obj).filter(function (_ref2) {
      var _ref3 = _slicedToArray(_ref2, 1),
        key = _ref3[0];
      return !keySet.has(key);
    }).map(function (_ref4) {
      var _ref5 = _slicedToArray(_ref4, 2),
        key = _ref5[0],
        val = _ref5[1];
      return _defineProperty({}, key, val);
    }))));
  };

  function index (kapsuleComponent, {
    wrapperElementType = 'div',
    nodeMapper = node => node,
    methodNames = [],
    initPropNames = []
  } = {}) {
    return /*#__PURE__*/React.forwardRef((props, ref) => {
      const domEl = React.useRef();

      // instantiate the inner kapsule component with the defined initPropNames
      const comp = React.useMemo(() => {
        const configOptions = Object.fromEntries(initPropNames.filter(p => props.hasOwnProperty(p)).map(prop => [prop, props[prop]]));
        return kapsuleComponent(configOptions);
      }, []);
      useEffectOnce(() => {
        comp(nodeMapper(domEl.current)); // mount kapsule synchronously on this element ref, optionally mapped into an object that the kapsule understands
      }, React.useLayoutEffect);
      useEffectOnce(() => {
        // invoke destructor on unmount, if it exists
        return comp._destructor instanceof Function ? comp._destructor : undefined;
      });

      // Call a component method
      const _call = React.useCallback((method, ...args) => comp[method] instanceof Function ? comp[method](...args) : undefined // method not found
      , [comp]);

      // propagate component props that have changed
      const prevPropsRef = React.useRef({});
      Object.keys(omit(props, [...methodNames, ...initPropNames])) // initPropNames or methodNames should not be called
      .filter(p => prevPropsRef.current[p] !== props[p]).forEach(p => _call(p, props[p]));
      prevPropsRef.current = props;

      // bind external methods to parent ref
      React.useImperativeHandle(ref, () => Object.fromEntries(methodNames.map(method => [method, (...args) => _call(method, ...args)])), [_call]);
      return /*#__PURE__*/React.createElement(wrapperElementType, {
        ref: domEl
      });
    });
  }

  //

  // Handle R18 strict mode double mount at init
  function useEffectOnce(effect, useEffectFn = React.useEffect) {
    const destroyFunc = React.useRef();
    const effectCalled = React.useRef(false);
    const renderAfterCalled = React.useRef(false);
    const [val, setVal] = React.useState(0);
    if (effectCalled.current) {
      renderAfterCalled.current = true;
    }
    useEffectFn(() => {
      // only execute the effect first time around
      if (!effectCalled.current) {
        destroyFunc.current = effect();
        effectCalled.current = true;
      }

      // this forces one render after the effect is run
      setVal(val => val + 1);
      return () => {
        // if the comp didn't render since the useEffect was called,
        // we know it's the dummy React cycle
        if (!renderAfterCalled.current) return;
        if (destroyFunc.current) destroyFunc.current();

        // reset refs after teardown so a reused fiber re-initializes on remount
        destroyFunc.current = undefined;
        effectCalled.current = false;
        renderAfterCalled.current = false;
      };
    }, []);
  }

  return index;

}));
//# sourceMappingURL=react-kapsule.js.map
