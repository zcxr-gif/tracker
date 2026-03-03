/**
* @vue/shared v3.5.21
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
function Oe(e) {
    const t = Object.create(null);
    for (const n of e.split(","))
        t[n] = 1;
    return n => n in t
}
const X = {}
  , Et = []
  , Me = () => {}
  , Tr = () => !1
  , Jt = e => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && (e.charCodeAt(2) > 122 || e.charCodeAt(2) < 97)
  , ps = e => e.startsWith("onUpdate:")
  , re = Object.assign
  , gs = (e, t) => {
    const n = e.indexOf(t);
    n > -1 && e.splice(n, 1)
}
  , hc = Object.prototype.hasOwnProperty
  , Q = (e, t) => hc.call(e, t)
  , V = Array.isArray
  , vt = e => Mt(e) === "[object Map]"
  , mt = e => Mt(e) === "[object Set]"
  , er = e => Mt(e) === "[object Date]"
  , Zi = e => Mt(e) === "[object RegExp]"
  , G = e => typeof e == "function"
  , te = e => typeof e == "string"
  , ke = e => typeof e == "symbol"
  , ne = e => e !== null && typeof e == "object"
  , ms = e => (ne(e) || G(e)) && G(e.then) && G(e.catch)
  , Cr = Object.prototype.toString
  , Mt = e => Cr.call(e)
  , Qi = e => Mt(e).slice(8, -1)
  , wn = e => Mt(e) === "[object Object]"
  , _s = e => te(e) && e !== "NaN" && e[0] !== "-" && "" + parseInt(e, 10) === e
  , Tt = Oe(",key,ref,ref_for,ref_key,onVnodeBeforeMount,onVnodeMounted,onVnodeBeforeUpdate,onVnodeUpdated,onVnodeBeforeUnmount,onVnodeUnmounted")
  , dc = Oe("bind,cloak,else-if,else,for,html,if,model,on,once,pre,show,slot,text,memo")
  , ys = e => {
    const t = Object.create(null);
    return (n => t[n] || (t[n] = e(n)))
}
  , pc = /-\w/g
  , de = ys(e => e.replace(pc, t => t.slice(1).toUpperCase()))
  , gc = /\B([A-Z])/g
  , ve = ys(e => e.replace(gc, "-$1").toLowerCase())
  , Xt = ys(e => e.charAt(0).toUpperCase() + e.slice(1))
  , Bt = ys(e => e ? `on${Xt(e)}` : "")
  , be = (e, t) => !Object.is(e, t)
  , Ct = (e, ...t) => {
    for (let n = 0; n < e.length; n++)
        e[n](...t)
}
  , Sr = (e, t, n, s=!1) => {
    Object.defineProperty(e, t, {
        configurable: !0,
        enumerable: !1,
        writable: s,
        value: n
    })
}
  , gn = e => {
    const t = parseFloat(e);
    return isNaN(t) ? e : t
}
  , mn = e => {
    const t = te(e) ? Number(e) : NaN;
    return isNaN(t) ? e : t
}
;
let fi;
const On = () => fi || (fi = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : typeof global < "u" ? global : {})
  , mc = /^[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*$/;
function _c(e) {
    return mc.test(e) ? `__props.${e}` : `__props[${JSON.stringify(e)}]`
}
function yc(e, t) {
    return e + JSON.stringify(t, (n, s) => typeof s == "function" ? s.toString() : s)
}
const bc = {
    TEXT: 1,
    1: "TEXT",
    CLASS: 2,
    2: "CLASS",
    STYLE: 4,
    4: "STYLE",
    PROPS: 8,
    8: "PROPS",
    FULL_PROPS: 16,
    16: "FULL_PROPS",
    NEED_HYDRATION: 32,
    32: "NEED_HYDRATION",
    STABLE_FRAGMENT: 64,
    64: "STABLE_FRAGMENT",
    KEYED_FRAGMENT: 128,
    128: "KEYED_FRAGMENT",
    UNKEYED_FRAGMENT: 256,
    256: "UNKEYED_FRAGMENT",
    NEED_PATCH: 512,
    512: "NEED_PATCH",
    DYNAMIC_SLOTS: 1024,
    1024: "DYNAMIC_SLOTS",
    DEV_ROOT_FRAGMENT: 2048,
    2048: "DEV_ROOT_FRAGMENT",
    CACHED: -1,
    "-1": "CACHED",
    BAIL: -2,
    "-2": "BAIL"
}
  , Ec = {
    1: "TEXT",
    2: "CLASS",
    4: "STYLE",
    8: "PROPS",
    16: "FULL_PROPS",
    32: "NEED_HYDRATION",
    64: "STABLE_FRAGMENT",
    128: "KEYED_FRAGMENT",
    256: "UNKEYED_FRAGMENT",
    512: "NEED_PATCH",
    1024: "DYNAMIC_SLOTS",
    2048: "DEV_ROOT_FRAGMENT",
    [-1]: "CACHED",
    [-2]: "BAIL"
}
  , vc = {
    ELEMENT: 1,
    1: "ELEMENT",
    FUNCTIONAL_COMPONENT: 2,
    2: "FUNCTIONAL_COMPONENT",
    STATEFUL_COMPONENT: 4,
    4: "STATEFUL_COMPONENT",
    TEXT_CHILDREN: 8,
    8: "TEXT_CHILDREN",
    ARRAY_CHILDREN: 16,
    16: "ARRAY_CHILDREN",
    SLOTS_CHILDREN: 32,
    32: "SLOTS_CHILDREN",
    TELEPORT: 64,
    64: "TELEPORT",
    SUSPENSE: 128,
    128: "SUSPENSE",
    COMPONENT_SHOULD_KEEP_ALIVE: 256,
    256: "COMPONENT_SHOULD_KEEP_ALIVE",
    COMPONENT_KEPT_ALIVE: 512,
    512: "COMPONENT_KEPT_ALIVE",
    COMPONENT: 6,
    6: "COMPONENT"
}
  , Tc = {
    STABLE: 1,
    1: "STABLE",
    DYNAMIC: 2,
    2: "DYNAMIC",
    FORWARDED: 3,
    3: "FORWARDED"
}
  , Cc = {
    1: "STABLE",
    2: "DYNAMIC",
    3: "FORWARDED"
}
  , Sc = "Infinity,undefined,NaN,isFinite,isNaN,parseFloat,parseInt,decodeURI,decodeURIComponent,encodeURI,encodeURIComponent,Math,Number,Date,Array,Object,Boolean,String,RegExp,Map,Set,JSON,Intl,BigInt,console,Error,Symbol"
  , xr = Oe(Sc)
  , xc = xr
  , ai = 2;
function Ac(e, t=0, n=e.length) {
    if (t = Math.max(0, Math.min(t, e.length)),
    n = Math.max(0, Math.min(n, e.length)),
    t > n)
        return "";
    let s = e.split(/(\r?\n)/);
    const r = s.filter( (l, c) => c % 2 === 1);
    s = s.filter( (l, c) => c % 2 === 0);
    let i = 0;
    const o = [];
    for (let l = 0; l < s.length; l++)
        if (i += s[l].length + (r[l] && r[l].length || 0),
        i >= t) {
            for (let c = l - ai; c <= l + ai || n > i; c++) {
                if (c < 0 || c >= s.length)
                    continue;
                const u = c + 1;
                o.push(`${u}${" ".repeat(Math.max(3 - String(u).length, 0))}|  ${s[c]}`);
                const f = s[c].length
                  , h = r[c] && r[c].length || 0;
                if (c === l) {
                    const m = t - (i - (f + h))
                      , y = Math.max(1, n > i ? f - m : n - t);
                    o.push("   |  " + " ".repeat(m) + "^".repeat(y))
                } else if (c > l) {
                    if (n > i) {
                        const m = Math.max(Math.min(n - i, f), 1);
                        o.push("   |  " + "^".repeat(m))
                    }
                    i += f + h
                }
            }
            break
        }
    return o.join(`
`)
}
function zt(e) {
    if (V(e)) {
        const t = {};
        for (let n = 0; n < e.length; n++) {
            const s = e[n]
              , r = te(s) ? eo(s) : zt(s);
            if (r)
                for (const i in r)
                    t[i] = r[i]
        }
        return t
    } else if (te(e) || ne(e))
        return e
}
const wc = /;(?![^(]*\))/g
  , Oc = /:([^]+)/
  , Nc = /\/\*[^]*?\*\//g;
function eo(e) {
    const t = {};
    return e.replace(Nc, "").split(wc).forEach(n => {
        if (n) {
            const s = n.split(Oc);
            s.length > 1 && (t[s[0].trim()] = s[1].trim())
        }
    }
    ),
    t
}
function Rc(e) {
    if (!e)
        return "";
    if (te(e))
        return e;
    let t = "";
    for (const n in e) {
        const s = e[n];
        if (te(s) || typeof s == "number") {
            const r = n.startsWith("--") ? n : ve(n);
            t += `${r}:${s};`
        }
    }
    return t
}
function Zt(e) {
    let t = "";
    if (te(e))
        t = e;
    else if (V(e))
        for (let n = 0; n < e.length; n++) {
            const s = Zt(e[n]);
            s && (t += s + " ")
        }
    else if (ne(e))
        for (const n in e)
            e[n] && (t += n + " ");
    return t.trim()
}
function to(e) {
    if (!e)
        return null;
    let {class: t, style: n} = e;
    return t && !te(t) && (e.class = Zt(t)),
    n && (e.style = zt(n)),
    e
}
const Pc = "html,body,base,head,link,meta,style,title,address,article,aside,footer,header,hgroup,h1,h2,h3,h4,h5,h6,nav,section,div,dd,dl,dt,figcaption,figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,data,dfn,em,i,kbd,mark,q,rp,rt,ruby,s,samp,small,span,strong,sub,sup,time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,option,output,progress,select,textarea,details,dialog,menu,summary,template,blockquote,iframe,tfoot"
  , Mc = "svg,animate,animateMotion,animateTransform,circle,clipPath,color-profile,defs,desc,discard,ellipse,feBlend,feColorMatrix,feComponentTransfer,feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,feDistantLight,feDropShadow,feFlood,feFuncA,feFuncB,feFuncG,feFuncR,feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,feOffset,fePointLight,feSpecularLighting,feSpotLight,feTile,feTurbulence,filter,foreignObject,g,hatch,hatchpath,image,line,linearGradient,marker,mask,mesh,meshgradient,meshpatch,meshrow,metadata,mpath,path,pattern,polygon,polyline,radialGradient,rect,set,solidcolor,stop,switch,symbol,text,textPath,title,tspan,unknown,use,view"
  , Lc = "annotation,annotation-xml,maction,maligngroup,malignmark,math,menclose,merror,mfenced,mfrac,mfraction,mglyph,mi,mlabeledtr,mlongdiv,mmultiscripts,mn,mo,mover,mpadded,mphantom,mprescripts,mroot,mrow,ms,mscarries,mscarry,msgroup,msline,mspace,msqrt,msrow,mstack,mstyle,msub,msubsup,msup,mtable,mtd,mtext,mtr,munder,munderover,none,semantics"
  , Fc = "area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr"
  , Ic = Oe(Pc)
  , kc = Oe(Mc)
  , Dc = Oe(Lc)
  , Hc = Oe(Fc)
  , no = "itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly"
  , so = Oe(no)
  , Vc = Oe(no + ",async,autofocus,autoplay,controls,default,defer,disabled,hidden,inert,loop,open,required,reversed,scoped,seamless,checked,muted,multiple,selected");
function Ar(e) {
    return !!e || e === ""
}
const Uc = /[>/="'\u0009\u000a\u000c\u0020]/
  , Us = {};
function Bc(e) {
    if (Us.hasOwnProperty(e))
        return Us[e];
    const t = Uc.test(e);
    return t && console.error(`unsafe attribute name: ${e}`),
    Us[e] = !t
}
const jc = {
    acceptCharset: "accept-charset",
    className: "class",
    htmlFor: "for",
    httpEquiv: "http-equiv"
}
  , $c = Oe("accept,accept-charset,accesskey,action,align,allow,alt,async,autocapitalize,autocomplete,autofocus,autoplay,background,bgcolor,border,buffered,capture,challenge,charset,checked,cite,class,code,codebase,color,cols,colspan,content,contenteditable,contextmenu,controls,coords,crossorigin,csp,data,datetime,decoding,default,defer,dir,dirname,disabled,download,draggable,dropzone,enctype,enterkeyhint,for,form,formaction,formenctype,formmethod,formnovalidate,formtarget,headers,height,hidden,high,href,hreflang,http-equiv,icon,id,importance,inert,integrity,ismap,itemprop,keytype,kind,label,lang,language,loading,list,loop,low,manifest,max,maxlength,minlength,media,min,multiple,muted,name,novalidate,open,optimum,pattern,ping,placeholder,poster,preload,radiogroup,readonly,referrerpolicy,rel,required,reversed,rows,rowspan,sandbox,scope,scoped,selected,shape,size,sizes,slot,span,spellcheck,src,srcdoc,srclang,srcset,start,step,style,summary,tabindex,target,title,translate,type,usemap,value,width,wrap")
  , Kc = Oe("xmlns,accent-height,accumulate,additive,alignment-baseline,alphabetic,amplitude,arabic-form,ascent,attributeName,attributeType,azimuth,baseFrequency,baseline-shift,baseProfile,bbox,begin,bias,by,calcMode,cap-height,class,clip,clipPathUnits,clip-path,clip-rule,color,color-interpolation,color-interpolation-filters,color-profile,color-rendering,contentScriptType,contentStyleType,crossorigin,cursor,cx,cy,d,decelerate,descent,diffuseConstant,direction,display,divisor,dominant-baseline,dur,dx,dy,edgeMode,elevation,enable-background,end,exponent,fill,fill-opacity,fill-rule,filter,filterRes,filterUnits,flood-color,flood-opacity,font-family,font-size,font-size-adjust,font-stretch,font-style,font-variant,font-weight,format,from,fr,fx,fy,g1,g2,glyph-name,glyph-orientation-horizontal,glyph-orientation-vertical,glyphRef,gradientTransform,gradientUnits,hanging,height,href,hreflang,horiz-adv-x,horiz-origin-x,id,ideographic,image-rendering,in,in2,intercept,k,k1,k2,k3,k4,kernelMatrix,kernelUnitLength,kerning,keyPoints,keySplines,keyTimes,lang,lengthAdjust,letter-spacing,lighting-color,limitingConeAngle,local,marker-end,marker-mid,marker-start,markerHeight,markerUnits,markerWidth,mask,maskContentUnits,maskUnits,mathematical,max,media,method,min,mode,name,numOctaves,offset,opacity,operator,order,orient,orientation,origin,overflow,overline-position,overline-thickness,panose-1,paint-order,path,pathLength,patternContentUnits,patternTransform,patternUnits,ping,pointer-events,points,pointsAtX,pointsAtY,pointsAtZ,preserveAlpha,preserveAspectRatio,primitiveUnits,r,radius,referrerPolicy,refX,refY,rel,rendering-intent,repeatCount,repeatDur,requiredExtensions,requiredFeatures,restart,result,rotate,rx,ry,scale,seed,shape-rendering,slope,spacing,specularConstant,specularExponent,speed,spreadMethod,startOffset,stdDeviation,stemh,stemv,stitchTiles,stop-color,stop-opacity,strikethrough-position,strikethrough-thickness,string,stroke,stroke-dasharray,stroke-dashoffset,stroke-linecap,stroke-linejoin,stroke-miterlimit,stroke-opacity,stroke-width,style,surfaceScale,systemLanguage,tabindex,tableValues,target,targetX,targetY,text-anchor,text-decoration,text-rendering,textLength,to,transform,transform-origin,type,u1,u2,underline-position,underline-thickness,unicode,unicode-bidi,unicode-range,units-per-em,v-alphabetic,v-hanging,v-ideographic,v-mathematical,values,vector-effect,version,vert-adv-y,vert-origin-x,vert-origin-y,viewBox,viewTarget,visibility,width,widths,word-spacing,writing-mode,x,x-height,x1,x2,xChannelSelector,xlink:actuate,xlink:arcrole,xlink:href,xlink:role,xlink:show,xlink:title,xlink:type,xmlns:xlink,xml:base,xml:lang,xml:space,y,y1,y2,yChannelSelector,z,zoomAndPan")
  , Wc = Oe("accent,accentunder,actiontype,align,alignmentscope,altimg,altimg-height,altimg-valign,altimg-width,alttext,bevelled,close,columnsalign,columnlines,columnspan,denomalign,depth,dir,display,displaystyle,encoding,equalcolumns,equalrows,fence,fontstyle,fontweight,form,frame,framespacing,groupalign,height,href,id,indentalign,indentalignfirst,indentalignlast,indentshift,indentshiftfirst,indentshiftlast,indextype,justify,largetop,largeop,lquote,lspace,mathbackground,mathcolor,mathsize,mathvariant,maxsize,minlabelspacing,mode,other,overflow,position,rowalign,rowlines,rowspan,rquote,rspace,scriptlevel,scriptminsize,scriptsizemultiplier,selection,separator,separators,shift,side,src,stackalign,stretchy,subscriptshift,superscriptshift,symmetric,voffset,width,widths,xlink:href,xlink:show,xlink:type,xmlns");
function Gc(e) {
    if (e == null)
        return !1;
    const t = typeof e;
    return t === "string" || t === "number" || t === "boolean"
}
const qc = /["'&<>]/;
function Yc(e) {
    const t = "" + e
      , n = qc.exec(t);
    if (!n)
        return t;
    let s = "", r, i, o = 0;
    for (i = n.index; i < t.length; i++) {
        switch (t.charCodeAt(i)) {
        case 34:
            r = "&quot;";
            break;
        case 38:
            r = "&amp;";
            break;
        case 39:
            r = "&#39;";
            break;
        case 60:
            r = "&lt;";
            break;
        case 62:
            r = "&gt;";
            break;
        default:
            continue
        }
        o !== i && (s += t.slice(o, i)),
        o = i + 1,
        s += r
    }
    return o !== i ? s + t.slice(o, i) : s
}
const Jc = /^-?>|<!--|-->|--!>|<!-$/g;
function Xc(e) {
    return e.replace(Jc, "")
}
const ro = /[ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g;
function zc(e, t) {
    return e.replace(ro, n => t ? n === '"' ? '\\\\\\"' : `\\\\${n}` : `\\${n}`)
}
function Zc(e, t) {
    if (e.length !== t.length)
        return !1;
    let n = !0;
    for (let s = 0; n && s < e.length; s++)
        n = et(e[s], t[s]);
    return n
}
function et(e, t) {
    if (e === t)
        return !0;
    let n = er(e)
      , s = er(t);
    if (n || s)
        return n && s ? e.getTime() === t.getTime() : !1;
    if (n = ke(e),
    s = ke(t),
    n || s)
        return e === t;
    if (n = V(e),
    s = V(t),
    n || s)
        return n && s ? Zc(e, t) : !1;
    if (n = ne(e),
    s = ne(t),
    n || s) {
        if (!n || !s)
            return !1;
        const r = Object.keys(e).length
          , i = Object.keys(t).length;
        if (r !== i)
            return !1;
        for (const o in e) {
            const l = e.hasOwnProperty(o)
              , c = t.hasOwnProperty(o);
            if (l && !c || !l && c || !et(e[o], t[o]))
                return !1
        }
    }
    return String(e) === String(t)
}
function Nn(e, t) {
    return e.findIndex(n => et(n, t))
}
const io = e => !!(e && e.__v_isRef === !0)
  , wr = e => te(e) ? e : e == null ? "" : V(e) || ne(e) && (e.toString === Cr || !G(e.toString)) ? io(e) ? wr(e.value) : JSON.stringify(e, oo, 2) : String(e)
  , oo = (e, t) => io(t) ? oo(e, t.value) : vt(t) ? {
    [`Map(${t.size})`]: [...t.entries()].reduce( (n, [s,r], i) => (n[Bs(s, i) + " =>"] = r,
    n), {})
} : mt(t) ? {
    [`Set(${t.size})`]: [...t.values()].map(n => Bs(n))
} : ke(t) ? Bs(t) : ne(t) && !V(t) && !wn(t) ? String(t) : t
  , Bs = (e, t="") => {
    var n;
    return ke(e) ? `Symbol(${(n = e.description) != null ? n : t})` : e
}
;
function lo(e) {
    return e == null ? "initial" : typeof e == "string" ? e === "" ? " " : e : String(e)
}
const Nh = Object.freeze(Object.defineProperty({
    __proto__: null,
    EMPTY_ARR: Et,
    EMPTY_OBJ: X,
    NO: Tr,
    NOOP: Me,
    PatchFlagNames: Ec,
    PatchFlags: bc,
    ShapeFlags: vc,
    SlotFlags: Tc,
    camelize: de,
    capitalize: Xt,
    cssVarNameEscapeSymbolsRE: ro,
    def: Sr,
    escapeHtml: Yc,
    escapeHtmlComment: Xc,
    extend: re,
    genCacheKey: yc,
    genPropsAccessExp: _c,
    generateCodeFrame: Ac,
    getEscapedCssVarName: zc,
    getGlobalThis: On,
    hasChanged: be,
    hasOwn: Q,
    hyphenate: ve,
    includeBooleanAttr: Ar,
    invokeArrayFns: Ct,
    isArray: V,
    isBooleanAttr: Vc,
    isBuiltInDirective: dc,
    isDate: er,
    isFunction: G,
    isGloballyAllowed: xr,
    isGloballyWhitelisted: xc,
    isHTMLTag: Ic,
    isIntegerKey: _s,
    isKnownHtmlAttr: $c,
    isKnownMathMLAttr: Wc,
    isKnownSvgAttr: Kc,
    isMap: vt,
    isMathMLTag: Dc,
    isModelListener: ps,
    isObject: ne,
    isOn: Jt,
    isPlainObject: wn,
    isPromise: ms,
    isRegExp: Zi,
    isRenderableAttrValue: Gc,
    isReservedProp: Tt,
    isSSRSafeAttrName: Bc,
    isSVGTag: kc,
    isSet: mt,
    isSpecialBooleanAttr: so,
    isString: te,
    isSymbol: ke,
    isVoidTag: Hc,
    looseEqual: et,
    looseIndexOf: Nn,
    looseToNumber: gn,
    makeMap: Oe,
    normalizeClass: Zt,
    normalizeCssVarValue: lo,
    normalizeProps: to,
    normalizeStyle: zt,
    objectToString: Cr,
    parseStringStyle: eo,
    propsToAttrMap: jc,
    remove: gs,
    slotFlagsText: Cc,
    stringifyStyle: Rc,
    toDisplayString: wr,
    toHandlerKey: Bt,
    toNumber: mn,
    toRawType: Qi,
    toTypeString: Mt
}, Symbol.toStringTag, {
    value: "Module"
}));
/**
* @vue/reactivity v3.5.21
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
let ye;
class Or {
    constructor(t=!1) {
        this.detached = t,
        this._active = !0,
        this._on = 0,
        this.effects = [],
        this.cleanups = [],
        this._isPaused = !1,
        this.parent = ye,
        !t && ye && (this.index = (ye.scopes || (ye.scopes = [])).push(this) - 1)
    }
    get active() {
        return this._active
    }
    pause() {
        if (this._active) {
            this._isPaused = !0;
            let t, n;
            if (this.scopes)
                for (t = 0,
                n = this.scopes.length; t < n; t++)
                    this.scopes[t].pause();
            for (t = 0,
            n = this.effects.length; t < n; t++)
                this.effects[t].pause()
        }
    }
    resume() {
        if (this._active && this._isPaused) {
            this._isPaused = !1;
            let t, n;
            if (this.scopes)
                for (t = 0,
                n = this.scopes.length; t < n; t++)
                    this.scopes[t].resume();
            for (t = 0,
            n = this.effects.length; t < n; t++)
                this.effects[t].resume()
        }
    }
    run(t) {
        if (this._active) {
            const n = ye;
            try {
                return ye = this,
                t()
            } finally {
                ye = n
            }
        }
    }
    on() {
        ++this._on === 1 && (this.prevScope = ye,
        ye = this)
    }
    off() {
        this._on > 0 && --this._on === 0 && (ye = this.prevScope,
        this.prevScope = void 0)
    }
    stop(t) {
        if (this._active) {
            this._active = !1;
            let n, s;
            for (n = 0,
            s = this.effects.length; n < s; n++)
                this.effects[n].stop();
            for (this.effects.length = 0,
            n = 0,
            s = this.cleanups.length; n < s; n++)
                this.cleanups[n]();
            if (this.cleanups.length = 0,
            this.scopes) {
                for (n = 0,
                s = this.scopes.length; n < s; n++)
                    this.scopes[n].stop(!0);
                this.scopes.length = 0
            }
            if (!this.detached && this.parent && !t) {
                const r = this.parent.scopes.pop();
                r && r !== this && (this.parent.scopes[this.index] = r,
                r.index = this.index)
            }
            this.parent = void 0
        }
    }
}
function Nr(e) {
    return new Or(e)
}
function Rr() {
    return ye
}
function co(e, t=!1) {
    ye && ye.cleanups.push(e)
}
let oe;
const js = new WeakSet;
class _n {
    constructor(t) {
        this.fn = t,
        this.deps = void 0,
        this.depsTail = void 0,
        this.flags = 5,
        this.next = void 0,
        this.cleanup = void 0,
        this.scheduler = void 0,
        ye && ye.active && ye.effects.push(this)
    }
    pause() {
        this.flags |= 64
    }
    resume() {
        this.flags & 64 && (this.flags &= -65,
        js.has(this) && (js.delete(this),
        this.trigger()))
    }
    notify() {
        this.flags & 2 && !(this.flags & 32) || this.flags & 8 || ao(this)
    }
    run() {
        if (!(this.flags & 1))
            return this.fn();
        this.flags |= 2,
        ui(this),
        uo(this);
        const t = oe
          , n = Ue;
        oe = this,
        Ue = !0;
        try {
            return this.fn()
        } finally {
            ho(this),
            oe = t,
            Ue = n,
            this.flags &= -3
        }
    }
    stop() {
        if (this.flags & 1) {
            for (let t = this.deps; t; t = t.nextDep)
                Lr(t);
            this.deps = this.depsTail = void 0,
            ui(this),
            this.onStop && this.onStop(),
            this.flags &= -2
        }
    }
    trigger() {
        this.flags & 64 ? js.add(this) : this.scheduler ? this.scheduler() : this.runIfDirty()
    }
    runIfDirty() {
        tr(this) && this.run()
    }
    get dirty() {
        return tr(this)
    }
}
let fo = 0, cn, fn;
function ao(e, t=!1) {
    if (e.flags |= 8,
    t) {
        e.next = fn,
        fn = e;
        return
    }
    e.next = cn,
    cn = e
}
function Pr() {
    fo++
}
function Mr() {
    if (--fo > 0)
        return;
    if (fn) {
        let t = fn;
        for (fn = void 0; t; ) {
            const n = t.next;
            t.next = void 0,
            t.flags &= -9,
            t = n
        }
    }
    let e;
    for (; cn; ) {
        let t = cn;
        for (cn = void 0; t; ) {
            const n = t.next;
            if (t.next = void 0,
            t.flags &= -9,
            t.flags & 1)
                try {
                    t.trigger()
                } catch (s) {
                    e || (e = s)
                }
            t = n
        }
    }
    if (e)
        throw e
}
function uo(e) {
    for (let t = e.deps; t; t = t.nextDep)
        t.version = -1,
        t.prevActiveLink = t.dep.activeLink,
        t.dep.activeLink = t
}
function ho(e) {
    let t, n = e.depsTail, s = n;
    for (; s; ) {
        const r = s.prevDep;
        s.version === -1 ? (s === n && (n = r),
        Lr(s),
        Qc(s)) : t = s,
        s.dep.activeLink = s.prevActiveLink,
        s.prevActiveLink = void 0,
        s = r
    }
    e.deps = t,
    e.depsTail = n
}
function tr(e) {
    for (let t = e.deps; t; t = t.nextDep)
        if (t.dep.version !== t.version || t.dep.computed && (po(t.dep.computed) || t.dep.version !== t.version))
            return !0;
    return !!e._dirty
}
function po(e) {
    if (e.flags & 4 && !(e.flags & 16) || (e.flags &= -17,
    e.globalVersion === yn) || (e.globalVersion = yn,
    !e.isSSR && e.flags & 128 && (!e.deps && !e._dirty || !tr(e))))
        return;
    e.flags |= 2;
    const t = e.dep
      , n = oe
      , s = Ue;
    oe = e,
    Ue = !0;
    try {
        uo(e);
        const r = e.fn(e._value);
        (t.version === 0 || be(r, e._value)) && (e.flags |= 128,
        e._value = r,
        t.version++)
    } catch (r) {
        throw t.version++,
        r
    } finally {
        oe = n,
        Ue = s,
        ho(e),
        e.flags &= -3
    }
}
function Lr(e, t=!1) {
    const {dep: n, prevSub: s, nextSub: r} = e;
    if (s && (s.nextSub = r,
    e.prevSub = void 0),
    r && (r.prevSub = s,
    e.nextSub = void 0),
    n.subs === e && (n.subs = s,
    !s && n.computed)) {
        n.computed.flags &= -5;
        for (let i = n.computed.deps; i; i = i.nextDep)
            Lr(i, !0)
    }
    !t && !--n.sc && n.map && n.map.delete(n.key)
}
function Qc(e) {
    const {prevDep: t, nextDep: n} = e;
    t && (t.nextDep = n,
    e.prevDep = void 0),
    n && (n.prevDep = t,
    e.nextDep = void 0)
}
function ef(e, t) {
    e.effect instanceof _n && (e = e.effect.fn);
    const n = new _n(e);
    t && re(n, t);
    try {
        n.run()
    } catch (r) {
        throw n.stop(),
        r
    }
    const s = n.run.bind(n);
    return s.effect = n,
    s
}
function tf(e) {
    e.effect.stop()
}
let Ue = !0;
const go = [];
function tt() {
    go.push(Ue),
    Ue = !1
}
function nt() {
    const e = go.pop();
    Ue = e === void 0 ? !0 : e
}
function ui(e) {
    const {cleanup: t} = e;
    if (e.cleanup = void 0,
    t) {
        const n = oe;
        oe = void 0;
        try {
            t()
        } finally {
            oe = n
        }
    }
}
let yn = 0;
class nf {
    constructor(t, n) {
        this.sub = t,
        this.dep = n,
        this.version = n.version,
        this.nextDep = this.prevDep = this.nextSub = this.prevSub = this.prevActiveLink = void 0
    }
}
class bs {
    constructor(t) {
        this.computed = t,
        this.version = 0,
        this.activeLink = void 0,
        this.subs = void 0,
        this.map = void 0,
        this.key = void 0,
        this.sc = 0,
        this.__v_skip = !0
    }
    track(t) {
        if (!oe || !Ue || oe === this.computed)
            return;
        let n = this.activeLink;
        if (n === void 0 || n.sub !== oe)
            n = this.activeLink = new nf(oe,this),
            oe.deps ? (n.prevDep = oe.depsTail,
            oe.depsTail.nextDep = n,
            oe.depsTail = n) : oe.deps = oe.depsTail = n,
            mo(n);
        else if (n.version === -1 && (n.version = this.version,
        n.nextDep)) {
            const s = n.nextDep;
            s.prevDep = n.prevDep,
            n.prevDep && (n.prevDep.nextDep = s),
            n.prevDep = oe.depsTail,
            n.nextDep = void 0,
            oe.depsTail.nextDep = n,
            oe.depsTail = n,
            oe.deps === n && (oe.deps = s)
        }
        return n
    }
    trigger(t) {
        this.version++,
        yn++,
        this.notify(t)
    }
    notify(t) {
        Pr();
        try {
            for (let n = this.subs; n; n = n.prevSub)
                n.sub.notify() && n.sub.dep.notify()
        } finally {
            Mr()
        }
    }
}
function mo(e) {
    if (e.dep.sc++,
    e.sub.flags & 4) {
        const t = e.dep.computed;
        if (t && !e.dep.subs) {
            t.flags |= 20;
            for (let s = t.deps; s; s = s.nextDep)
                mo(s)
        }
        const n = e.dep.subs;
        n !== e && (e.prevSub = n,
        n && (n.nextSub = e)),
        e.dep.subs = e
    }
}
const Zn = new WeakMap
  , St = Symbol("")
  , nr = Symbol("")
  , bn = Symbol("");
function Ee(e, t, n) {
    if (Ue && oe) {
        let s = Zn.get(e);
        s || Zn.set(e, s = new Map);
        let r = s.get(n);
        r || (s.set(n, r = new bs),
        r.map = s,
        r.key = n),
        r.track()
    }
}
function ze(e, t, n, s, r, i) {
    const o = Zn.get(e);
    if (!o) {
        yn++;
        return
    }
    const l = c => {
        c && c.trigger()
    }
    ;
    if (Pr(),
    t === "clear")
        o.forEach(l);
    else {
        const c = V(e)
          , u = c && _s(n);
        if (c && n === "length") {
            const f = Number(s);
            o.forEach( (h, m) => {
                (m === "length" || m === bn || !ke(m) && m >= f) && l(h)
            }
            )
        } else
            switch ((n !== void 0 || o.has(void 0)) && l(o.get(n)),
            u && l(o.get(bn)),
            t) {
            case "add":
                c ? u && l(o.get("length")) : (l(o.get(St)),
                vt(e) && l(o.get(nr)));
                break;
            case "delete":
                c || (l(o.get(St)),
                vt(e) && l(o.get(nr)));
                break;
            case "set":
                vt(e) && l(o.get(St));
                break
            }
    }
    Mr()
}
function sf(e, t) {
    const n = Zn.get(e);
    return n && n.get(t)
}
function It(e) {
    const t = J(e);
    return t === e ? t : (Ee(t, "iterate", bn),
    Le(e) ? t : t.map(pe))
}
function Es(e) {
    return Ee(e = J(e), "iterate", bn),
    e
}
const rf = {
    __proto__: null,
    [Symbol.iterator]() {
        return $s(this, Symbol.iterator, pe)
    },
    concat(...e) {
        return It(this).concat(...e.map(t => V(t) ? It(t) : t))
    },
    entries() {
        return $s(this, "entries", e => (e[1] = pe(e[1]),
        e))
    },
    every(e, t) {
        return Ye(this, "every", e, t, void 0, arguments)
    },
    filter(e, t) {
        return Ye(this, "filter", e, t, n => n.map(pe), arguments)
    },
    find(e, t) {
        return Ye(this, "find", e, t, pe, arguments)
    },
    findIndex(e, t) {
        return Ye(this, "findIndex", e, t, void 0, arguments)
    },
    findLast(e, t) {
        return Ye(this, "findLast", e, t, pe, arguments)
    },
    findLastIndex(e, t) {
        return Ye(this, "findLastIndex", e, t, void 0, arguments)
    },
    forEach(e, t) {
        return Ye(this, "forEach", e, t, void 0, arguments)
    },
    includes(...e) {
        return Ks(this, "includes", e)
    },
    indexOf(...e) {
        return Ks(this, "indexOf", e)
    },
    join(e) {
        return It(this).join(e)
    },
    lastIndexOf(...e) {
        return Ks(this, "lastIndexOf", e)
    },
    map(e, t) {
        return Ye(this, "map", e, t, void 0, arguments)
    },
    pop() {
        return nn(this, "pop")
    },
    push(...e) {
        return nn(this, "push", e)
    },
    reduce(e, ...t) {
        return hi(this, "reduce", e, t)
    },
    reduceRight(e, ...t) {
        return hi(this, "reduceRight", e, t)
    },
    shift() {
        return nn(this, "shift")
    },
    some(e, t) {
        return Ye(this, "some", e, t, void 0, arguments)
    },
    splice(...e) {
        return nn(this, "splice", e)
    },
    toReversed() {
        return It(this).toReversed()
    },
    toSorted(e) {
        return It(this).toSorted(e)
    },
    toSpliced(...e) {
        return It(this).toSpliced(...e)
    },
    unshift(...e) {
        return nn(this, "unshift", e)
    },
    values() {
        return $s(this, "values", pe)
    }
};
function $s(e, t, n) {
    const s = Es(e)
      , r = s[t]();
    return s !== e && !Le(e) && (r._next = r.next,
    r.next = () => {
        const i = r._next();
        return i.value && (i.value = n(i.value)),
        i
    }
    ),
    r
}
const of = Array.prototype;
function Ye(e, t, n, s, r, i) {
    const o = Es(e)
      , l = o !== e && !Le(e)
      , c = o[t];
    if (c !== of[t]) {
        const h = c.apply(e, i);
        return l ? pe(h) : h
    }
    let u = n;
    o !== e && (l ? u = function(h, m) {
        return n.call(this, pe(h), m, e)
    }
    : n.length > 2 && (u = function(h, m) {
        return n.call(this, h, m, e)
    }
    ));
    const f = c.call(o, u, s);
    return l && r ? r(f) : f
}
function hi(e, t, n, s) {
    const r = Es(e);
    let i = n;
    return r !== e && (Le(e) ? n.length > 3 && (i = function(o, l, c) {
        return n.call(this, o, l, c, e)
    }
    ) : i = function(o, l, c) {
        return n.call(this, o, pe(l), c, e)
    }
    ),
    r[t](i, ...s)
}
function Ks(e, t, n) {
    const s = J(e);
    Ee(s, "iterate", bn);
    const r = s[t](...n);
    return (r === -1 || r === !1) && Cs(n[0]) ? (n[0] = J(n[0]),
    s[t](...n)) : r
}
function nn(e, t, n=[]) {
    tt(),
    Pr();
    const s = J(e)[t].apply(e, n);
    return Mr(),
    nt(),
    s
}
const lf = Oe("__proto__,__v_isRef,__isVue")
  , _o = new Set(Object.getOwnPropertyNames(Symbol).filter(e => e !== "arguments" && e !== "caller").map(e => Symbol[e]).filter(ke));
function cf(e) {
    ke(e) || (e = String(e));
    const t = J(this);
    return Ee(t, "has", e),
    t.hasOwnProperty(e)
}
class yo {
    constructor(t=!1, n=!1) {
        this._isReadonly = t,
        this._isShallow = n
    }
    get(t, n, s) {
        if (n === "__v_skip")
            return t.__v_skip;
        const r = this._isReadonly
          , i = this._isShallow;
        if (n === "__v_isReactive")
            return !r;
        if (n === "__v_isReadonly")
            return r;
        if (n === "__v_isShallow")
            return i;
        if (n === "__v_raw")
            return s === (r ? i ? So : Co : i ? To : vo).get(t) || Object.getPrototypeOf(t) === Object.getPrototypeOf(s) ? t : void 0;
        const o = V(t);
        if (!r) {
            let c;
            if (o && (c = rf[n]))
                return c;
            if (n === "hasOwnProperty")
                return cf
        }
        const l = Reflect.get(t, n, le(t) ? t : s);
        return (ke(n) ? _o.has(n) : lf(n)) || (r || Ee(t, "get", n),
        i) ? l : le(l) ? o && _s(n) ? l : l.value : ne(l) ? r ? Fr(l) : Rn(l) : l
    }
}
class bo extends yo {
    constructor(t=!1) {
        super(!1, t)
    }
    set(t, n, s, r) {
        let i = t[n];
        if (!this._isShallow) {
            const c = st(i);
            if (!Le(s) && !st(s) && (i = J(i),
            s = J(s)),
            !V(t) && le(i) && !le(s))
                return c || (i.value = s),
                !0
        }
        const o = V(t) && _s(n) ? Number(n) < t.length : Q(t, n)
          , l = Reflect.set(t, n, s, le(t) ? t : r);
        return t === J(r) && (o ? be(s, i) && ze(t, "set", n, s) : ze(t, "add", n, s)),
        l
    }
    deleteProperty(t, n) {
        const s = Q(t, n);
        t[n];
        const r = Reflect.deleteProperty(t, n);
        return r && s && ze(t, "delete", n, void 0),
        r
    }
    has(t, n) {
        const s = Reflect.has(t, n);
        return (!ke(n) || !_o.has(n)) && Ee(t, "has", n),
        s
    }
    ownKeys(t) {
        return Ee(t, "iterate", V(t) ? "length" : St),
        Reflect.ownKeys(t)
    }
}
class Eo extends yo {
    constructor(t=!1) {
        super(!0, t)
    }
    set(t, n) {
        return !0
    }
    deleteProperty(t, n) {
        return !0
    }
}
const ff = new bo
  , af = new Eo
  , uf = new bo(!0)
  , hf = new Eo(!0)
  , sr = e => e
  , Hn = e => Reflect.getPrototypeOf(e);
function df(e, t, n) {
    return function(...s) {
        const r = this.__v_raw
          , i = J(r)
          , o = vt(i)
          , l = e === "entries" || e === Symbol.iterator && o
          , c = e === "keys" && o
          , u = r[e](...s)
          , f = n ? sr : t ? Qn : pe;
        return !t && Ee(i, "iterate", c ? nr : St),
        {
            next() {
                const {value: h, done: m} = u.next();
                return m ? {
                    value: h,
                    done: m
                } : {
                    value: l ? [f(h[0]), f(h[1])] : f(h),
                    done: m
                }
            },
            [Symbol.iterator]() {
                return this
            }
        }
    }
}
function Vn(e) {
    return function(...t) {
        return e === "delete" ? !1 : e === "clear" ? void 0 : this
    }
}
function pf(e, t) {
    const n = {
        get(r) {
            const i = this.__v_raw
              , o = J(i)
              , l = J(r);
            e || (be(r, l) && Ee(o, "get", r),
            Ee(o, "get", l));
            const {has: c} = Hn(o)
              , u = t ? sr : e ? Qn : pe;
            if (c.call(o, r))
                return u(i.get(r));
            if (c.call(o, l))
                return u(i.get(l));
            i !== o && i.get(r)
        },
        get size() {
            const r = this.__v_raw;
            return !e && Ee(J(r), "iterate", St),
            r.size
        },
        has(r) {
            const i = this.__v_raw
              , o = J(i)
              , l = J(r);
            return e || (be(r, l) && Ee(o, "has", r),
            Ee(o, "has", l)),
            r === l ? i.has(r) : i.has(r) || i.has(l)
        },
        forEach(r, i) {
            const o = this
              , l = o.__v_raw
              , c = J(l)
              , u = t ? sr : e ? Qn : pe;
            return !e && Ee(c, "iterate", St),
            l.forEach( (f, h) => r.call(i, u(f), u(h), o))
        }
    };
    return re(n, e ? {
        add: Vn("add"),
        set: Vn("set"),
        delete: Vn("delete"),
        clear: Vn("clear")
    } : {
        add(r) {
            !t && !Le(r) && !st(r) && (r = J(r));
            const i = J(this);
            return Hn(i).has.call(i, r) || (i.add(r),
            ze(i, "add", r, r)),
            this
        },
        set(r, i) {
            !t && !Le(i) && !st(i) && (i = J(i));
            const o = J(this)
              , {has: l, get: c} = Hn(o);
            let u = l.call(o, r);
            u || (r = J(r),
            u = l.call(o, r));
            const f = c.call(o, r);
            return o.set(r, i),
            u ? be(i, f) && ze(o, "set", r, i) : ze(o, "add", r, i),
            this
        },
        delete(r) {
            const i = J(this)
              , {has: o, get: l} = Hn(i);
            let c = o.call(i, r);
            c || (r = J(r),
            c = o.call(i, r)),
            l && l.call(i, r);
            const u = i.delete(r);
            return c && ze(i, "delete", r, void 0),
            u
        },
        clear() {
            const r = J(this)
              , i = r.size !== 0
              , o = r.clear();
            return i && ze(r, "clear", void 0, void 0),
            o
        }
    }),
    ["keys", "values", "entries", Symbol.iterator].forEach(r => {
        n[r] = df(r, e, t)
    }
    ),
    n
}
function vs(e, t) {
    const n = pf(e, t);
    return (s, r, i) => r === "__v_isReactive" ? !e : r === "__v_isReadonly" ? e : r === "__v_raw" ? s : Reflect.get(Q(n, r) && r in s ? n : s, r, i)
}
const gf = {
    get: vs(!1, !1)
}
  , mf = {
    get: vs(!1, !0)
}
  , _f = {
    get: vs(!0, !1)
}
  , yf = {
    get: vs(!0, !0)
}
  , vo = new WeakMap
  , To = new WeakMap
  , Co = new WeakMap
  , So = new WeakMap;
function bf(e) {
    switch (e) {
    case "Object":
    case "Array":
        return 1;
    case "Map":
    case "Set":
    case "WeakMap":
    case "WeakSet":
        return 2;
    default:
        return 0
    }
}
function Ef(e) {
    return e.__v_skip || !Object.isExtensible(e) ? 0 : bf(Qi(e))
}
function Rn(e) {
    return st(e) ? e : Ts(e, !1, ff, gf, vo)
}
function xo(e) {
    return Ts(e, !1, uf, mf, To)
}
function Fr(e) {
    return Ts(e, !0, af, _f, Co)
}
function vf(e) {
    return Ts(e, !0, hf, yf, So)
}
function Ts(e, t, n, s, r) {
    if (!ne(e) || e.__v_raw && !(t && e.__v_isReactive))
        return e;
    const i = Ef(e);
    if (i === 0)
        return e;
    const o = r.get(e);
    if (o)
        return o;
    const l = new Proxy(e,i === 2 ? s : n);
    return r.set(e, l),
    l
}
function Be(e) {
    return st(e) ? Be(e.__v_raw) : !!(e && e.__v_isReactive)
}
function st(e) {
    return !!(e && e.__v_isReadonly)
}
function Le(e) {
    return !!(e && e.__v_isShallow)
}
function Cs(e) {
    return e ? !!e.__v_raw : !1
}
function J(e) {
    const t = e && e.__v_raw;
    return t ? J(t) : e
}
function Ss(e) {
    return !Q(e, "__v_skip") && Object.isExtensible(e) && Sr(e, "__v_skip", !0),
    e
}
const pe = e => ne(e) ? Rn(e) : e
  , Qn = e => ne(e) ? Fr(e) : e;
function le(e) {
    return e ? e.__v_isRef === !0 : !1
}
function xt(e) {
    return wo(e, !1)
}
function Ao(e) {
    return wo(e, !0)
}
function wo(e, t) {
    return le(e) ? e : new Tf(e,t)
}
class Tf {
    constructor(t, n) {
        this.dep = new bs,
        this.__v_isRef = !0,
        this.__v_isShallow = !1,
        this._rawValue = n ? t : J(t),
        this._value = n ? t : pe(t),
        this.__v_isShallow = n
    }
    get value() {
        return this.dep.track(),
        this._value
    }
    set value(t) {
        const n = this._rawValue
          , s = this.__v_isShallow || Le(t) || st(t);
        t = s ? t : J(t),
        be(t, n) && (this._rawValue = t,
        this._value = s ? t : pe(t),
        this.dep.trigger())
    }
}
function Cf(e) {
    e.dep && e.dep.trigger()
}
function xs(e) {
    return le(e) ? e.value : e
}
function Sf(e) {
    return G(e) ? e() : xs(e)
}
const xf = {
    get: (e, t, n) => t === "__v_raw" ? e : xs(Reflect.get(e, t, n)),
    set: (e, t, n, s) => {
        const r = e[t];
        return le(r) && !le(n) ? (r.value = n,
        !0) : Reflect.set(e, t, n, s)
    }
};
function Ir(e) {
    return Be(e) ? e : new Proxy(e,xf)
}
class Af {
    constructor(t) {
        this.__v_isRef = !0,
        this._value = void 0;
        const n = this.dep = new bs
          , {get: s, set: r} = t(n.track.bind(n), n.trigger.bind(n));
        this._get = s,
        this._set = r
    }
    get value() {
        return this._value = this._get()
    }
    set value(t) {
        this._set(t)
    }
}
function Oo(e) {
    return new Af(e)
}
function No(e) {
    const t = V(e) ? new Array(e.length) : {};
    for (const n in e)
        t[n] = Po(e, n);
    return t
}
class wf {
    constructor(t, n, s) {
        this._object = t,
        this._key = n,
        this._defaultValue = s,
        this.__v_isRef = !0,
        this._value = void 0
    }
    get value() {
        const t = this._object[this._key];
        return this._value = t === void 0 ? this._defaultValue : t
    }
    set value(t) {
        this._object[this._key] = t
    }
    get dep() {
        return sf(J(this._object), this._key)
    }
}
class Of {
    constructor(t) {
        this._getter = t,
        this.__v_isRef = !0,
        this.__v_isReadonly = !0,
        this._value = void 0
    }
    get value() {
        return this._value = this._getter()
    }
}
function Ro(e, t, n) {
    return le(e) ? e : G(e) ? new Of(e) : ne(e) && arguments.length > 1 ? Po(e, t, n) : xt(e)
}
function Po(e, t, n) {
    const s = e[t];
    return le(s) ? s : new wf(e,t,n)
}
class Nf {
    constructor(t, n, s) {
        this.fn = t,
        this.setter = n,
        this._value = void 0,
        this.dep = new bs(this),
        this.__v_isRef = !0,
        this.deps = void 0,
        this.depsTail = void 0,
        this.flags = 16,
        this.globalVersion = yn - 1,
        this.next = void 0,
        this.effect = this,
        this.__v_isReadonly = !n,
        this.isSSR = s
    }
    notify() {
        if (this.flags |= 16,
        !(this.flags & 8) && oe !== this)
            return ao(this, !0),
            !0
    }
    get value() {
        const t = this.dep.track();
        return po(this),
        t && (t.version = this.dep.version),
        this._value
    }
    set value(t) {
        this.setter && this.setter(t)
    }
}
function Rf(e, t, n=!1) {
    let s, r;
    return G(e) ? s = e : (s = e.get,
    r = e.set),
    new Nf(s,r,n)
}
const Pf = {
    GET: "get",
    HAS: "has",
    ITERATE: "iterate"
}
  , Mf = {
    SET: "set",
    ADD: "add",
    DELETE: "delete",
    CLEAR: "clear"
}
  , Un = {}
  , es = new WeakMap;
let at;
function Lf() {
    return at
}
function Mo(e, t=!1, n=at) {
    if (n) {
        let s = es.get(n);
        s || es.set(n, s = []),
        s.push(e)
    }
}
function Ff(e, t, n=X) {
    const {immediate: s, deep: r, once: i, scheduler: o, augmentJob: l, call: c} = n
      , u = g => r ? g : Le(g) || r === !1 || r === 0 ? Ze(g, 1) : Ze(g);
    let f, h, m, y, T = !1, v = !1;
    if (le(e) ? (h = () => e.value,
    T = Le(e)) : Be(e) ? (h = () => u(e),
    T = !0) : V(e) ? (v = !0,
    T = e.some(g => Be(g) || Le(g)),
    h = () => e.map(g => {
        if (le(g))
            return g.value;
        if (Be(g))
            return u(g);
        if (G(g))
            return c ? c(g, 2) : g()
    }
    )) : G(e) ? t ? h = c ? () => c(e, 2) : e : h = () => {
        if (m) {
            tt();
            try {
                m()
            } finally {
                nt()
            }
        }
        const g = at;
        at = f;
        try {
            return c ? c(e, 3, [y]) : e(y)
        } finally {
            at = g
        }
    }
    : h = Me,
    t && r) {
        const g = h
          , _ = r === !0 ? 1 / 0 : r;
        h = () => Ze(g(), _)
    }
    const B = Rr()
      , D = () => {
        f.stop(),
        B && B.active && gs(B.effects, f)
    }
    ;
    if (i && t) {
        const g = t;
        t = (..._) => {
            g(..._),
            D()
        }
    }
    let A = v ? new Array(e.length).fill(Un) : Un;
    const p = g => {
        if (!(!(f.flags & 1) || !f.dirty && !g))
            if (t) {
                const _ = f.run();
                if (r || T || (v ? _.some( (R, F) => be(R, A[F])) : be(_, A))) {
                    m && m();
                    const R = at;
                    at = f;
                    try {
                        const F = [_, A === Un ? void 0 : v && A[0] === Un ? [] : A, y];
                        A = _,
                        c ? c(t, 3, F) : t(...F)
                    } finally {
                        at = R
                    }
                }
            } else
                f.run()
    }
    ;
    return l && l(p),
    f = new _n(h),
    f.scheduler = o ? () => o(p, !1) : p,
    y = g => Mo(g, !1, f),
    m = f.onStop = () => {
        const g = es.get(f);
        if (g) {
            if (c)
                c(g, 4);
            else
                for (const _ of g)
                    _();
            es.delete(f)
        }
    }
    ,
    t ? s ? p(!0) : A = f.run() : o ? o(p.bind(null, !0), !0) : f.run(),
    D.pause = f.pause.bind(f),
    D.resume = f.resume.bind(f),
    D.stop = D,
    D
}
function Ze(e, t=1 / 0, n) {
    if (t <= 0 || !ne(e) || e.__v_skip || (n = n || new Map,
    (n.get(e) || 0) >= t))
        return e;
    if (n.set(e, t),
    t--,
    le(e))
        Ze(e.value, t, n);
    else if (V(e))
        for (let s = 0; s < e.length; s++)
            Ze(e[s], t, n);
    else if (mt(e) || vt(e))
        e.forEach(s => {
            Ze(s, t, n)
        }
        );
    else if (wn(e)) {
        for (const s in e)
            Ze(e[s], t, n);
        for (const s of Object.getOwnPropertySymbols(e))
            Object.prototype.propertyIsEnumerable.call(e, s) && Ze(e[s], t, n)
    }
    return e
}
/**
* @vue/runtime-core v3.5.21
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
const Lo = [];
function If(e) {
    Lo.push(e)
}
function kf() {
    Lo.pop()
}
function Df(e, t) {}
const Hf = {
    SETUP_FUNCTION: 0,
    0: "SETUP_FUNCTION",
    RENDER_FUNCTION: 1,
    1: "RENDER_FUNCTION",
    NATIVE_EVENT_HANDLER: 5,
    5: "NATIVE_EVENT_HANDLER",
    COMPONENT_EVENT_HANDLER: 6,
    6: "COMPONENT_EVENT_HANDLER",
    VNODE_HOOK: 7,
    7: "VNODE_HOOK",
    DIRECTIVE_HOOK: 8,
    8: "DIRECTIVE_HOOK",
    TRANSITION_HOOK: 9,
    9: "TRANSITION_HOOK",
    APP_ERROR_HANDLER: 10,
    10: "APP_ERROR_HANDLER",
    APP_WARN_HANDLER: 11,
    11: "APP_WARN_HANDLER",
    FUNCTION_REF: 12,
    12: "FUNCTION_REF",
    ASYNC_COMPONENT_LOADER: 13,
    13: "ASYNC_COMPONENT_LOADER",
    SCHEDULER: 14,
    14: "SCHEDULER",
    COMPONENT_UPDATE: 15,
    15: "COMPONENT_UPDATE",
    APP_UNMOUNT_CLEANUP: 16,
    16: "APP_UNMOUNT_CLEANUP"
}
  , Vf = {
    sp: "serverPrefetch hook",
    bc: "beforeCreate hook",
    c: "created hook",
    bm: "beforeMount hook",
    m: "mounted hook",
    bu: "beforeUpdate hook",
    u: "updated",
    bum: "beforeUnmount hook",
    um: "unmounted hook",
    a: "activated hook",
    da: "deactivated hook",
    ec: "errorCaptured hook",
    rtc: "renderTracked hook",
    rtg: "renderTriggered hook",
    0: "setup function",
    1: "render function",
    2: "watcher getter",
    3: "watcher callback",
    4: "watcher cleanup function",
    5: "native event handler",
    6: "component event handler",
    7: "vnode hook",
    8: "directive hook",
    9: "transition hook",
    10: "app errorHandler",
    11: "app warnHandler",
    12: "ref function",
    13: "async component loader",
    14: "scheduler flush",
    15: "component update",
    16: "app unmount cleanup function"
};
function Qt(e, t, n, s) {
    try {
        return s ? e(...s) : e()
    } catch (r) {
        Lt(r, t, n)
    }
}
function De(e, t, n, s) {
    if (G(e)) {
        const r = Qt(e, t, n, s);
        return r && ms(r) && r.catch(i => {
            Lt(i, t, n)
        }
        ),
        r
    }
    if (V(e)) {
        const r = [];
        for (let i = 0; i < e.length; i++)
            r.push(De(e[i], t, n, s));
        return r
    }
}
function Lt(e, t, n, s=!0) {
    const r = t ? t.vnode : null
      , {errorHandler: i, throwUnhandledErrorInProduction: o} = t && t.appContext.config || X;
    if (t) {
        let l = t.parent;
        const c = t.proxy
          , u = `https://vuejs.org/error-reference/#runtime-${n}`;
        for (; l; ) {
            const f = l.ec;
            if (f) {
                for (let h = 0; h < f.length; h++)
                    if (f[h](e, c, u) === !1)
                        return
            }
            l = l.parent
        }
        if (i) {
            tt(),
            Qt(i, null, 10, [e, c, u]),
            nt();
            return
        }
    }
    Uf(e, n, r, s, o)
}
function Uf(e, t, n, s=!0, r=!1) {
    if (r)
        throw e;
    console.error(e)
}
const Se = [];
let We = -1;
const jt = [];
let ut = null
  , Ht = 0;
const Fo = Promise.resolve();
let ts = null;
function Pn(e) {
    const t = ts || Fo;
    return e ? t.then(this ? e.bind(this) : e) : t
}
function Bf(e) {
    let t = We + 1
      , n = Se.length;
    for (; t < n; ) {
        const s = t + n >>> 1
          , r = Se[s]
          , i = vn(r);
        i < e || i === e && r.flags & 2 ? t = s + 1 : n = s
    }
    return t
}
function kr(e) {
    if (!(e.flags & 1)) {
        const t = vn(e)
          , n = Se[Se.length - 1];
        !n || !(e.flags & 2) && t >= vn(n) ? Se.push(e) : Se.splice(Bf(t), 0, e),
        e.flags |= 1,
        Io()
    }
}
function Io() {
    ts || (ts = Fo.then(ko))
}
function En(e) {
    V(e) ? jt.push(...e) : ut && e.id === -1 ? ut.splice(Ht + 1, 0, e) : e.flags & 1 || (jt.push(e),
    e.flags |= 1),
    Io()
}
function di(e, t, n=We + 1) {
    for (; n < Se.length; n++) {
        const s = Se[n];
        if (s && s.flags & 2) {
            if (e && s.id !== e.uid)
                continue;
            Se.splice(n, 1),
            n--,
            s.flags & 4 && (s.flags &= -2),
            s(),
            s.flags & 4 || (s.flags &= -2)
        }
    }
}
function ns(e) {
    if (jt.length) {
        const t = [...new Set(jt)].sort( (n, s) => vn(n) - vn(s));
        if (jt.length = 0,
        ut) {
            ut.push(...t);
            return
        }
        for (ut = t,
        Ht = 0; Ht < ut.length; Ht++) {
            const n = ut[Ht];
            n.flags & 4 && (n.flags &= -2),
            n.flags & 8 || n(),
            n.flags &= -2
        }
        ut = null,
        Ht = 0
    }
}
const vn = e => e.id == null ? e.flags & 2 ? -1 : 1 / 0 : e.id;
function ko(e) {
    try {
        for (We = 0; We < Se.length; We++) {
            const t = Se[We];
            t && !(t.flags & 8) && (t.flags & 4 && (t.flags &= -2),
            Qt(t, t.i, t.i ? 15 : 14),
            t.flags & 4 || (t.flags &= -2))
        }
    } finally {
        for (; We < Se.length; We++) {
            const t = Se[We];
            t && (t.flags &= -2)
        }
        We = -1,
        Se.length = 0,
        ns(),
        ts = null,
        (Se.length || jt.length) && ko()
    }
}
let Vt, Bn = [];
function Do(e, t) {
    var n, s;
    Vt = e,
    Vt ? (Vt.enabled = !0,
    Bn.forEach( ({event: r, args: i}) => Vt.emit(r, ...i)),
    Bn = []) : typeof window < "u" && window.HTMLElement && !((s = (n = window.navigator) == null ? void 0 : n.userAgent) != null && s.includes("jsdom")) ? ((t.__VUE_DEVTOOLS_HOOK_REPLAY__ = t.__VUE_DEVTOOLS_HOOK_REPLAY__ || []).push(i => {
        Do(i, t)
    }
    ),
    setTimeout( () => {
        Vt || (t.__VUE_DEVTOOLS_HOOK_REPLAY__ = null,
        Bn = [])
    }
    , 3e3)) : Bn = []
}
let me = null
  , As = null;
function Tn(e) {
    const t = me;
    return me = e,
    As = e && e.type.__scopeId || null,
    t
}
function jf(e) {
    As = e
}
function $f() {
    As = null
}
const Kf = e => Dr;
function Dr(e, t=me, n) {
    if (!t || e._n)
        return e;
    const s = (...r) => {
        s._d && An(-1);
        const i = Tn(t);
        let o;
        try {
            o = e(...r)
        } finally {
            Tn(i),
            s._d && An(1)
        }
        return o
    }
    ;
    return s._n = !0,
    s._c = !0,
    s._d = !0,
    s
}
function Wf(e, t) {
    if (me === null)
        return e;
    const n = In(me)
      , s = e.dirs || (e.dirs = []);
    for (let r = 0; r < t.length; r++) {
        let[i,o,l,c=X] = t[r];
        i && (G(i) && (i = {
            mounted: i,
            updated: i
        }),
        i.deep && Ze(o),
        s.push({
            dir: i,
            instance: n,
            value: o,
            oldValue: void 0,
            arg: l,
            modifiers: c
        }))
    }
    return e
}
function Ge(e, t, n, s) {
    const r = e.dirs
      , i = t && t.dirs;
    for (let o = 0; o < r.length; o++) {
        const l = r[o];
        i && (l.oldValue = i[o].value);
        let c = l.dir[s];
        c && (tt(),
        De(c, n, 8, [e.el, l, e, t]),
        nt())
    }
}
const Ho = Symbol("_vte")
  , Vo = e => e.__isTeleport
  , an = e => e && (e.disabled || e.disabled === "")
  , pi = e => e && (e.defer || e.defer === "")
  , gi = e => typeof SVGElement < "u" && e instanceof SVGElement
  , mi = e => typeof MathMLElement == "function" && e instanceof MathMLElement
  , rr = (e, t) => {
    const n = e && e.to;
    return te(n) ? t ? t(n) : null : n
}
  , Uo = {
    name: "Teleport",
    __isTeleport: !0,
    process(e, t, n, s, r, i, o, l, c, u) {
        const {mc: f, pc: h, pbc: m, o: {insert: y, querySelector: T, createText: v, createComment: B}} = u
          , D = an(t.props);
        let {shapeFlag: A, children: p, dynamicChildren: g} = t;
        if (e == null) {
            const _ = t.el = v("")
              , R = t.anchor = v("");
            y(_, n, s),
            y(R, n, s);
            const F = (E, C) => {
                A & 16 && (r && r.isCE && (r.ce._teleportTarget = E),
                f(p, E, C, r, i, o, l, c))
            }
              , P = () => {
                const E = t.target = rr(t.props, T)
                  , C = Bo(E, t, v, y);
                E && (o !== "svg" && gi(E) ? o = "svg" : o !== "mathml" && mi(E) && (o = "mathml"),
                D || (F(E, C),
                Yn(t, !1)))
            }
            ;
            D && (F(n, R),
            Yn(t, !0)),
            pi(t.props) ? (t.el.__isMounted = !1,
            ue( () => {
                P(),
                delete t.el.__isMounted
            }
            , i)) : P()
        } else {
            if (pi(t.props) && e.el.__isMounted === !1) {
                ue( () => {
                    Uo.process(e, t, n, s, r, i, o, l, c, u)
                }
                , i);
                return
            }
            t.el = e.el,
            t.targetStart = e.targetStart;
            const _ = t.anchor = e.anchor
              , R = t.target = e.target
              , F = t.targetAnchor = e.targetAnchor
              , P = an(e.props)
              , E = P ? n : R
              , C = P ? _ : F;
            if (o === "svg" || gi(R) ? o = "svg" : (o === "mathml" || mi(R)) && (o = "mathml"),
            g ? (m(e.dynamicChildren, g, E, r, i, o, l),
            Xr(e, t, !0)) : c || h(e, t, E, C, r, i, o, l, !1),
            D)
                P ? t.props && e.props && t.props.to !== e.props.to && (t.props.to = e.props.to) : jn(t, n, _, u, 1);
            else if ((t.props && t.props.to) !== (e.props && e.props.to)) {
                const U = t.target = rr(t.props, T);
                U && jn(t, U, null, u, 0)
            } else
                P && jn(t, R, F, u, 1);
            Yn(t, D)
        }
    },
    remove(e, t, n, {um: s, o: {remove: r}}, i) {
        const {shapeFlag: o, children: l, anchor: c, targetStart: u, targetAnchor: f, target: h, props: m} = e;
        if (h && (r(u),
        r(f)),
        i && r(c),
        o & 16) {
            const y = i || !an(m);
            for (let T = 0; T < l.length; T++) {
                const v = l[T];
                s(v, t, n, y, !!v.dynamicChildren)
            }
        }
    },
    move: jn,
    hydrate: Gf
};
function jn(e, t, n, {o: {insert: s}, m: r}, i=2) {
    i === 0 && s(e.targetAnchor, t, n);
    const {el: o, anchor: l, shapeFlag: c, children: u, props: f} = e
      , h = i === 2;
    if (h && s(o, t, n),
    (!h || an(f)) && c & 16)
        for (let m = 0; m < u.length; m++)
            r(u[m], t, n, 2);
    h && s(l, t, n)
}
function Gf(e, t, n, s, r, i, {o: {nextSibling: o, parentNode: l, querySelector: c, insert: u, createText: f}}, h) {
    function m(v, B, D, A) {
        B.anchor = h(o(v), B, l(v), n, s, r, i),
        B.targetStart = D,
        B.targetAnchor = A
    }
    const y = t.target = rr(t.props, c)
      , T = an(t.props);
    if (y) {
        const v = y._lpa || y.firstChild;
        if (t.shapeFlag & 16)
            if (T)
                m(e, t, v, v && o(v));
            else {
                t.anchor = o(e);
                let B = v;
                for (; B; ) {
                    if (B && B.nodeType === 8) {
                        if (B.data === "teleport start anchor")
                            t.targetStart = B;
                        else if (B.data === "teleport anchor") {
                            t.targetAnchor = B,
                            y._lpa = t.targetAnchor && o(t.targetAnchor);
                            break
                        }
                    }
                    B = o(B)
                }
                t.targetAnchor || Bo(y, t, f, u),
                h(v && o(v), t, y, n, s, r, i)
            }
        Yn(t, T)
    } else
        T && t.shapeFlag & 16 && m(e, t, e, o(e));
    return t.anchor && o(t.anchor)
}
const qf = Uo;
function Yn(e, t) {
    const n = e.ctx;
    if (n && n.ut) {
        let s, r;
        for (t ? (s = e.el,
        r = e.anchor) : (s = e.targetStart,
        r = e.targetAnchor); s && s !== r; )
            s.nodeType === 1 && s.setAttribute("data-v-owner", n.uid),
            s = s.nextSibling;
        n.ut()
    }
}
function Bo(e, t, n, s) {
    const r = t.targetStart = n("")
      , i = t.targetAnchor = n("");
    return r[Ho] = i,
    e && (s(r, e),
    s(i, e)),
    i
}
const Xe = Symbol("_leaveCb")
  , $n = Symbol("_enterCb");
function Hr() {
    const e = {
        isMounted: !1,
        isLeaving: !1,
        isUnmounting: !1,
        leavingVNodes: new Map
    };
    return Ln( () => {
        e.isMounted = !0
    }
    ),
    Rs( () => {
        e.isUnmounting = !0
    }
    ),
    e
}
const Fe = [Function, Array]
  , Vr = {
    mode: String,
    appear: Boolean,
    persisted: Boolean,
    onBeforeEnter: Fe,
    onEnter: Fe,
    onAfterEnter: Fe,
    onEnterCancelled: Fe,
    onBeforeLeave: Fe,
    onLeave: Fe,
    onAfterLeave: Fe,
    onLeaveCancelled: Fe,
    onBeforeAppear: Fe,
    onAppear: Fe,
    onAfterAppear: Fe,
    onAppearCancelled: Fe
}
  , jo = e => {
    const t = e.subTree;
    return t.component ? jo(t.component) : t
}
  , Yf = {
    name: "BaseTransition",
    props: Vr,
    setup(e, {slots: t}) {
        const n = Ne()
          , s = Hr();
        return () => {
            const r = t.default && ws(t.default(), !0);
            if (!r || !r.length)
                return;
            const i = $o(r)
              , o = J(e)
              , {mode: l} = o;
            if (s.isLeaving)
                return Ws(i);
            const c = _i(i);
            if (!c)
                return Ws(i);
            let u = Wt(c, o, s, n, h => u = h);
            c.type !== fe && rt(c, u);
            let f = n.subTree && _i(n.subTree);
            if (f && f.type !== fe && !Ve(f, c) && jo(n).type !== fe) {
                let h = Wt(f, o, s, n);
                if (rt(f, h),
                l === "out-in" && c.type !== fe)
                    return s.isLeaving = !0,
                    h.afterLeave = () => {
                        s.isLeaving = !1,
                        n.job.flags & 8 || n.update(),
                        delete h.afterLeave,
                        f = void 0
                    }
                    ,
                    Ws(i);
                l === "in-out" && c.type !== fe ? h.delayLeave = (m, y, T) => {
                    const v = Wo(s, f);
                    v[String(f.key)] = f,
                    m[Xe] = () => {
                        y(),
                        m[Xe] = void 0,
                        delete u.delayedLeave,
                        f = void 0
                    }
                    ,
                    u.delayedLeave = () => {
                        T(),
                        delete u.delayedLeave,
                        f = void 0
                    }
                }
                : f = void 0
            } else
                f && (f = void 0);
            return i
        }
    }
};
function $o(e) {
    let t = e[0];
    if (e.length > 1) {
        for (const n of e)
            if (n.type !== fe) {
                t = n;
                break
            }
    }
    return t
}
const Ko = Yf;
function Wo(e, t) {
    const {leavingVNodes: n} = e;
    let s = n.get(t.type);
    return s || (s = Object.create(null),
    n.set(t.type, s)),
    s
}
function Wt(e, t, n, s, r) {
    const {appear: i, mode: o, persisted: l=!1, onBeforeEnter: c, onEnter: u, onAfterEnter: f, onEnterCancelled: h, onBeforeLeave: m, onLeave: y, onAfterLeave: T, onLeaveCancelled: v, onBeforeAppear: B, onAppear: D, onAfterAppear: A, onAppearCancelled: p} = t
      , g = String(e.key)
      , _ = Wo(n, e)
      , R = (E, C) => {
        E && De(E, s, 9, C)
    }
      , F = (E, C) => {
        const U = C[1];
        R(E, C),
        V(E) ? E.every(w => w.length <= 1) && U() : E.length <= 1 && U()
    }
      , P = {
        mode: o,
        persisted: l,
        beforeEnter(E) {
            let C = c;
            if (!n.isMounted)
                if (i)
                    C = B || c;
                else
                    return;
            E[Xe] && E[Xe](!0);
            const U = _[g];
            U && Ve(e, U) && U.el[Xe] && U.el[Xe](),
            R(C, [E])
        },
        enter(E) {
            let C = u
              , U = f
              , w = h;
            if (!n.isMounted)
                if (i)
                    C = D || u,
                    U = A || f,
                    w = p || h;
                else
                    return;
            let K = !1;
            const z = E[$n] = se => {
                K || (K = !0,
                se ? R(w, [E]) : R(U, [E]),
                P.delayedLeave && P.delayedLeave(),
                E[$n] = void 0)
            }
            ;
            C ? F(C, [E, z]) : z()
        },
        leave(E, C) {
            const U = String(e.key);
            if (E[$n] && E[$n](!0),
            n.isUnmounting)
                return C();
            R(m, [E]);
            let w = !1;
            const K = E[Xe] = z => {
                w || (w = !0,
                C(),
                z ? R(v, [E]) : R(T, [E]),
                E[Xe] = void 0,
                _[U] === e && delete _[U])
            }
            ;
            _[U] = e,
            y ? F(y, [E, K]) : K()
        },
        clone(E) {
            const C = Wt(E, t, n, s, r);
            return r && r(C),
            C
        }
    };
    return P
}
function Ws(e) {
    if (Mn(e))
        return e = qe(e),
        e.children = null,
        e
}
function _i(e) {
    if (!Mn(e))
        return Vo(e.type) && e.children ? $o(e.children) : e;
    if (e.component)
        return e.component.subTree;
    const {shapeFlag: t, children: n} = e;
    if (n) {
        if (t & 16)
            return n[0];
        if (t & 32 && G(n.default))
            return n.default()
    }
}
function rt(e, t) {
    e.shapeFlag & 6 && e.component ? (e.transition = t,
    rt(e.component.subTree, t)) : e.shapeFlag & 128 ? (e.ssContent.transition = t.clone(e.ssContent),
    e.ssFallback.transition = t.clone(e.ssFallback)) : e.transition = t
}
function ws(e, t=!1, n) {
    let s = []
      , r = 0;
    for (let i = 0; i < e.length; i++) {
        let o = e[i];
        const l = n == null ? o.key : String(n) + String(o.key != null ? o.key : i);
        o.type === he ? (o.patchFlag & 128 && r++,
        s = s.concat(ws(o.children, t, l))) : (t || o.type !== fe) && s.push(l != null ? qe(o, {
            key: l
        }) : o)
    }
    if (r > 1)
        for (let i = 0; i < s.length; i++)
            s[i].patchFlag = -2;
    return s
}
function Ur(e, t) {
    return G(e) ? re({
        name: e.name
    }, t, {
        setup: e
    }) : e
}
function Jf() {
    const e = Ne();
    return e ? (e.appContext.config.idPrefix || "v") + "-" + e.ids[0] + e.ids[1]++ : ""
}
function Br(e) {
    e.ids = [e.ids[0] + e.ids[2]++ + "-", 0, 0]
}
function Xf(e) {
    const t = Ne()
      , n = Ao(null);
    if (t) {
        const r = t.refs === X ? t.refs = {} : t.refs;
        Object.defineProperty(r, e, {
            enumerable: !0,
            get: () => n.value,
            set: i => n.value = i
        })
    }
    return n
}
const ss = new WeakMap;
function $t(e, t, n, s, r=!1) {
    if (V(e)) {
        e.forEach( (T, v) => $t(T, t && (V(t) ? t[v] : t), n, s, r));
        return
    }
    if (dt(s) && !r) {
        s.shapeFlag & 512 && s.type.__asyncResolved && s.component.subTree.component && $t(e, t, n, s.component.subTree);
        return
    }
    const i = s.shapeFlag & 4 ? In(s.component) : s.el
      , o = r ? null : i
      , {i: l, r: c} = e
      , u = t && t.r
      , f = l.refs === X ? l.refs = {} : l.refs
      , h = l.setupState
      , m = J(h)
      , y = h === X ? Tr : T => Q(m, T);
    if (u != null && u !== c) {
        if (yi(t),
        te(u))
            f[u] = null,
            y(u) && (h[u] = null);
        else if (le(u)) {
            u.value = null;
            const T = t;
            T.k && (f[T.k] = null)
        }
    }
    if (G(c))
        Qt(c, l, 12, [o, f]);
    else {
        const T = te(c)
          , v = le(c);
        if (T || v) {
            const B = () => {
                if (e.f) {
                    const D = T ? y(c) ? h[c] : f[c] : c.value;
                    if (r)
                        V(D) && gs(D, i);
                    else if (V(D))
                        D.includes(i) || D.push(i);
                    else if (T)
                        f[c] = [i],
                        y(c) && (h[c] = f[c]);
                    else {
                        const A = [i];
                        c.value = A,
                        e.k && (f[e.k] = A)
                    }
                } else
                    T ? (f[c] = o,
                    y(c) && (h[c] = o)) : v && (c.value = o,
                    e.k && (f[e.k] = o))
            }
            ;
            if (o) {
                const D = () => {
                    B(),
                    ss.delete(e)
                }
                ;
                D.id = -1,
                ss.set(e, D),
                ue(D, n)
            } else
                yi(e),
                B()
        }
    }
}
function yi(e) {
    const t = ss.get(e);
    t && (t.flags |= 8,
    ss.delete(e))
}
let bi = !1;
const kt = () => {
    bi || (console.error("Hydration completed but contains mismatches."),
    bi = !0)
}
  , zf = e => e.namespaceURI.includes("svg") && e.tagName !== "foreignObject"
  , Zf = e => e.namespaceURI.includes("MathML")
  , Kn = e => {
    if (e.nodeType === 1) {
        if (zf(e))
            return "svg";
        if (Zf(e))
            return "mathml"
    }
}
  , Ut = e => e.nodeType === 8;
function Qf(e) {
    const {mt: t, p: n, o: {patchProp: s, createText: r, nextSibling: i, parentNode: o, remove: l, insert: c, createComment: u}} = e
      , f = (p, g) => {
        if (!g.hasChildNodes()) {
            n(null, p, g),
            ns(),
            g._vnode = p;
            return
        }
        h(g.firstChild, p, null, null, null),
        ns(),
        g._vnode = p
    }
      , h = (p, g, _, R, F, P=!1) => {
        P = P || !!g.dynamicChildren;
        const E = Ut(p) && p.data === "["
          , C = () => v(p, g, _, R, F, E)
          , {type: U, ref: w, shapeFlag: K, patchFlag: z} = g;
        let se = p.nodeType;
        g.el = p,
        z === -2 && (P = !1,
        g.dynamicChildren = null);
        let H = null;
        switch (U) {
        case pt:
            se !== 3 ? g.children === "" ? (c(g.el = r(""), o(p), p),
            H = p) : H = C() : (p.data !== g.children && (kt(),
            p.data = g.children),
            H = i(p));
            break;
        case fe:
            A(p) ? (H = i(p),
            D(g.el = p.content.firstChild, p, _)) : se !== 8 || E ? H = C() : H = i(p);
            break;
        case Nt:
            if (E && (p = i(p),
            se = p.nodeType),
            se === 1 || se === 3) {
                H = p;
                const W = !g.children.length;
                for (let j = 0; j < g.staticCount; j++)
                    W && (g.children += H.nodeType === 1 ? H.outerHTML : H.data),
                    j === g.staticCount - 1 && (g.anchor = H),
                    H = i(H);
                return E ? i(H) : H
            } else
                C();
            break;
        case he:
            E ? H = T(p, g, _, R, F, P) : H = C();
            break;
        default:
            if (K & 1)
                (se !== 1 || g.type.toLowerCase() !== p.tagName.toLowerCase()) && !A(p) ? H = C() : H = m(p, g, _, R, F, P);
            else if (K & 6) {
                g.slotScopeIds = F;
                const W = o(p);
                if (E ? H = B(p) : Ut(p) && p.data === "teleport start" ? H = B(p, p.data, "teleport end") : H = i(p),
                t(g, W, null, _, R, Kn(W), P),
                dt(g) && !g.type.__asyncResolved) {
                    let j;
                    E ? (j = ce(he),
                    j.anchor = H ? H.previousSibling : W.lastChild) : j = p.nodeType === 3 ? Zr("") : ce("div"),
                    j.el = p,
                    g.component.subTree = j
                }
            } else
                K & 64 ? se !== 8 ? H = C() : H = g.type.hydrate(p, g, _, R, F, P, e, y) : K & 128 && (H = g.type.hydrate(p, g, _, R, Kn(o(p)), F, P, e, h))
        }
        return w != null && $t(w, null, R, g),
        H
    }
      , m = (p, g, _, R, F, P) => {
        P = P || !!g.dynamicChildren;
        const {type: E, props: C, patchFlag: U, shapeFlag: w, dirs: K, transition: z} = g
          , se = E === "input" || E === "option";
        if (se || U !== -1) {
            K && Ge(g, null, _, "created");
            let H = !1;
            if (A(p)) {
                H = ml(null, z) && _ && _.vnode.props && _.vnode.props.appear;
                const j = p.content.firstChild;
                if (H) {
                    const ae = j.getAttribute("class");
                    ae && (j.$cls = ae),
                    z.beforeEnter(j)
                }
                D(j, p, _),
                g.el = p = j
            }
            if (w & 16 && !(C && (C.innerHTML || C.textContent))) {
                let j = y(p.firstChild, g, p, _, R, F, P);
                for (; j; ) {
                    Wn(p, 1) || kt();
                    const ae = j;
                    j = j.nextSibling,
                    l(ae)
                }
            } else if (w & 8) {
                let j = g.children;
                j[0] === `
` && (p.tagName === "PRE" || p.tagName === "TEXTAREA") && (j = j.slice(1)),
                p.textContent !== j && (Wn(p, 0) || kt(),
                p.textContent = g.children)
            }
            if (C) {
                if (se || !P || U & 48) {
                    const j = p.tagName.includes("-");
                    for (const ae in C)
                        (se && (ae.endsWith("value") || ae === "indeterminate") || Jt(ae) && !Tt(ae) || ae[0] === "." || j) && s(p, ae, null, C[ae], void 0, _)
                } else if (C.onClick)
                    s(p, "onClick", null, C.onClick, void 0, _);
                else if (U & 4 && Be(C.style))
                    for (const j in C.style)
                        C.style[j]
            }
            let W;
            (W = C && C.onVnodeBeforeMount) && Ae(W, _, g),
            K && Ge(g, null, _, "beforeMount"),
            ((W = C && C.onVnodeMounted) || K || H) && xl( () => {
                W && Ae(W, _, g),
                H && z.enter(p),
                K && Ge(g, null, _, "mounted")
            }
            , R)
        }
        return p.nextSibling
    }
      , y = (p, g, _, R, F, P, E) => {
        E = E || !!g.dynamicChildren;
        const C = g.children
          , U = C.length;
        for (let w = 0; w < U; w++) {
            const K = E ? C[w] : C[w] = we(C[w])
              , z = K.type === pt;
            p ? (z && !E && w + 1 < U && we(C[w + 1]).type === pt && (c(r(p.data.slice(K.children.length)), _, i(p)),
            p.data = K.children),
            p = h(p, K, R, F, P, E)) : z && !K.children ? c(K.el = r(""), _) : (Wn(_, 1) || kt(),
            n(null, K, _, null, R, F, Kn(_), P))
        }
        return p
    }
      , T = (p, g, _, R, F, P) => {
        const {slotScopeIds: E} = g;
        E && (F = F ? F.concat(E) : E);
        const C = o(p)
          , U = y(i(p), g, C, _, R, F, P);
        return U && Ut(U) && U.data === "]" ? i(g.anchor = U) : (kt(),
        c(g.anchor = u("]"), C, U),
        U)
    }
      , v = (p, g, _, R, F, P) => {
        if (Wn(p.parentElement, 1) || kt(),
        g.el = null,
        P) {
            const U = B(p);
            for (; ; ) {
                const w = i(p);
                if (w && w !== U)
                    l(w);
                else
                    break
            }
        }
        const E = i(p)
          , C = o(p);
        return l(p),
        n(null, g, C, E, _, R, Kn(C), F),
        _ && (_.vnode.el = g.el,
        Ls(_, g.el)),
        E
    }
      , B = (p, g="[", _="]") => {
        let R = 0;
        for (; p; )
            if (p = i(p),
            p && Ut(p) && (p.data === g && R++,
            p.data === _)) {
                if (R === 0)
                    return i(p);
                R--
            }
        return p
    }
      , D = (p, g, _) => {
        const R = g.parentNode;
        R && R.replaceChild(p, g);
        let F = _;
        for (; F; )
            F.vnode.el === g && (F.vnode.el = F.subTree.el = p),
            F = F.parent
    }
      , A = p => p.nodeType === 1 && p.tagName === "TEMPLATE";
    return [f, h]
}
const Ei = "data-allow-mismatch"
  , ea = {
    0: "text",
    1: "children",
    2: "class",
    3: "style",
    4: "attribute"
};
function Wn(e, t) {
    if (t === 0 || t === 1)
        for (; e && !e.hasAttribute(Ei); )
            e = e.parentElement;
    const n = e && e.getAttribute(Ei);
    if (n == null)
        return !1;
    if (n === "")
        return !0;
    {
        const s = n.split(",");
        return t === 0 && s.includes("children") ? !0 : s.includes(ea[t])
    }
}
const ta = On().requestIdleCallback || (e => setTimeout(e, 1))
  , na = On().cancelIdleCallback || (e => clearTimeout(e))
  , sa = (e=1e4) => t => {
    const n = ta(t, {
        timeout: e
    });
    return () => na(n)
}
;
function ra(e) {
    const {top: t, left: n, bottom: s, right: r} = e.getBoundingClientRect()
      , {innerHeight: i, innerWidth: o} = window;
    return (t > 0 && t < i || s > 0 && s < i) && (n > 0 && n < o || r > 0 && r < o)
}
const ia = e => (t, n) => {
    const s = new IntersectionObserver(r => {
        for (const i of r)
            if (i.isIntersecting) {
                s.disconnect(),
                t();
                break
            }
    }
    ,e);
    return n(r => {
        if (r instanceof Element) {
            if (ra(r))
                return t(),
                s.disconnect(),
                !1;
            s.observe(r)
        }
    }
    ),
    () => s.disconnect()
}
  , oa = e => t => {
    if (e) {
        const n = matchMedia(e);
        if (n.matches)
            t();
        else
            return n.addEventListener("change", t, {
                once: !0
            }),
            () => n.removeEventListener("change", t)
    }
}
  , la = (e=[]) => (t, n) => {
    te(e) && (e = [e]);
    let s = !1;
    const r = o => {
        s || (s = !0,
        i(),
        t(),
        o.target.dispatchEvent(new o.constructor(o.type,o)))
    }
      , i = () => {
        n(o => {
            for (const l of e)
                o.removeEventListener(l, r)
        }
        )
    }
    ;
    return n(o => {
        for (const l of e)
            o.addEventListener(l, r, {
                once: !0
            })
    }
    ),
    i
}
;
function ca(e, t) {
    if (Ut(e) && e.data === "[") {
        let n = 1
          , s = e.nextSibling;
        for (; s; ) {
            if (s.nodeType === 1) {
                if (t(s) === !1)
                    break
            } else if (Ut(s))
                if (s.data === "]") {
                    if (--n === 0)
                        break
                } else
                    s.data === "[" && n++;
            s = s.nextSibling
        }
    } else
        t(e)
}
const dt = e => !!e.type.__asyncLoader;
function fa(e) {
    G(e) && (e = {
        loader: e
    });
    const {loader: t, loadingComponent: n, errorComponent: s, delay: r=200, hydrate: i, timeout: o, suspensible: l=!0, onError: c} = e;
    let u = null, f, h = 0;
    const m = () => (h++,
    u = null,
    y())
      , y = () => {
        let T;
        return u || (T = u = t().catch(v => {
            if (v = v instanceof Error ? v : new Error(String(v)),
            c)
                return new Promise( (B, D) => {
                    c(v, () => B(m()), () => D(v), h + 1)
                }
                );
            throw v
        }
        ).then(v => T !== u && u ? u : (v && (v.__esModule || v[Symbol.toStringTag] === "Module") && (v = v.default),
        f = v,
        v)))
    }
    ;
    return Ur({
        name: "AsyncComponentWrapper",
        __asyncLoader: y,
        __asyncHydrate(T, v, B) {
            let D = !1;
            (v.bu || (v.bu = [])).push( () => D = !0);
            const A = () => {
                D || B()
            }
              , p = i ? () => {
                const g = i(A, _ => ca(T, _));
                g && (v.bum || (v.bum = [])).push(g)
            }
            : A;
            f ? p() : y().then( () => !v.isUnmounted && p())
        },
        get __asyncResolved() {
            return f
        },
        setup() {
            const T = ge;
            if (Br(T),
            f)
                return () => Gs(f, T);
            const v = p => {
                u = null,
                Lt(p, T, 13, !s)
            }
            ;
            if (l && T.suspense || Gt)
                return y().then(p => () => Gs(p, T)).catch(p => (v(p),
                () => s ? ce(s, {
                    error: p
                }) : null));
            const B = xt(!1)
              , D = xt()
              , A = xt(!!r);
            return r && setTimeout( () => {
                A.value = !1
            }
            , r),
            o != null && setTimeout( () => {
                if (!B.value && !D.value) {
                    const p = new Error(`Async component timed out after ${o}ms.`);
                    v(p),
                    D.value = p
                }
            }
            , o),
            y().then( () => {
                B.value = !0,
                T.parent && Mn(T.parent.vnode) && T.parent.update()
            }
            ).catch(p => {
                v(p),
                D.value = p
            }
            ),
            () => {
                if (B.value && f)
                    return Gs(f, T);
                if (D.value && s)
                    return ce(s, {
                        error: D.value
                    });
                if (n && !A.value)
                    return ce(n)
            }
        }
    })
}
function Gs(e, t) {
    const {ref: n, props: s, children: r, ce: i} = t.vnode
      , o = ce(e, s, r);
    return o.ref = n,
    o.ce = i,
    delete t.vnode.ce,
    o
}
const Mn = e => e.type.__isKeepAlive
  , aa = {
    name: "KeepAlive",
    __isKeepAlive: !0,
    props: {
        include: [String, RegExp, Array],
        exclude: [String, RegExp, Array],
        max: [String, Number]
    },
    setup(e, {slots: t}) {
        const n = Ne()
          , s = n.ctx;
        if (!s.renderer)
            return () => {
                const A = t.default && t.default();
                return A && A.length === 1 ? A[0] : A
            }
            ;
        const r = new Map
          , i = new Set;
        let o = null;
        const l = n.suspense
          , {renderer: {p: c, m: u, um: f, o: {createElement: h}}} = s
          , m = h("div");
        s.activate = (A, p, g, _, R) => {
            const F = A.component;
            u(A, p, g, 0, l),
            c(F.vnode, A, p, g, F, l, _, A.slotScopeIds, R),
            ue( () => {
                F.isDeactivated = !1,
                F.a && Ct(F.a);
                const P = A.props && A.props.onVnodeMounted;
                P && Ae(P, F.parent, A)
            }
            , l)
        }
        ,
        s.deactivate = A => {
            const p = A.component;
            is(p.m),
            is(p.a),
            u(A, m, null, 1, l),
            ue( () => {
                p.da && Ct(p.da);
                const g = A.props && A.props.onVnodeUnmounted;
                g && Ae(g, p.parent, A),
                p.isDeactivated = !0
            }
            , l)
        }
        ;
        function y(A) {
            qs(A),
            f(A, n, l, !0)
        }
        function T(A) {
            r.forEach( (p, g) => {
                const _ = gr(p.type);
                _ && !A(_) && v(g)
            }
            )
        }
        function v(A) {
            const p = r.get(A);
            p && (!o || !Ve(p, o)) ? y(p) : o && qs(o),
            r.delete(A),
            i.delete(A)
        }
        Ot( () => [e.include, e.exclude], ([A,p]) => {
            A && T(g => on(A, g)),
            p && T(g => !on(p, g))
        }
        , {
            flush: "post",
            deep: !0
        });
        let B = null;
        const D = () => {
            B != null && (os(n.subTree.type) ? ue( () => {
                r.set(B, Gn(n.subTree))
            }
            , n.subTree.suspense) : r.set(B, Gn(n.subTree)))
        }
        ;
        return Ln(D),
        Ns(D),
        Rs( () => {
            r.forEach(A => {
                const {subTree: p, suspense: g} = n
                  , _ = Gn(p);
                if (A.type === _.type && A.key === _.key) {
                    qs(_);
                    const R = _.component.da;
                    R && ue(R, g);
                    return
                }
                y(A)
            }
            )
        }
        ),
        () => {
            if (B = null,
            !t.default)
                return o = null;
            const A = t.default()
              , p = A[0];
            if (A.length > 1)
                return o = null,
                A;
            if (!it(p) || !(p.shapeFlag & 4) && !(p.shapeFlag & 128))
                return o = null,
                p;
            let g = Gn(p);
            if (g.type === fe)
                return o = null,
                g;
            const _ = g.type
              , R = gr(dt(g) ? g.type.__asyncResolved || {} : _)
              , {include: F, exclude: P, max: E} = e;
            if (F && (!R || !on(F, R)) || P && R && on(P, R))
                return g.shapeFlag &= -257,
                o = g,
                p;
            const C = g.key == null ? _ : g.key
              , U = r.get(C);
            return g.el && (g = qe(g),
            p.shapeFlag & 128 && (p.ssContent = g)),
            B = C,
            U ? (g.el = U.el,
            g.component = U.component,
            g.transition && rt(g, g.transition),
            g.shapeFlag |= 512,
            i.delete(C),
            i.add(C)) : (i.add(C),
            E && i.size > parseInt(E, 10) && v(i.values().next().value)),
            g.shapeFlag |= 256,
            o = g,
            os(p.type) ? p : g
        }
    }
}
  , ua = aa;
function on(e, t) {
    return V(e) ? e.some(n => on(n, t)) : te(e) ? e.split(",").includes(t) : Zi(e) ? (e.lastIndex = 0,
    e.test(t)) : !1
}
function Go(e, t) {
    Yo(e, "a", t)
}
function qo(e, t) {
    Yo(e, "da", t)
}
function Yo(e, t, n=ge) {
    const s = e.__wdc || (e.__wdc = () => {
        let r = n;
        for (; r; ) {
            if (r.isDeactivated)
                return;
            r = r.parent
        }
        return e()
    }
    );
    if (Os(t, s, n),
    n) {
        let r = n.parent;
        for (; r && r.parent; )
            Mn(r.parent.vnode) && ha(s, t, n, r),
            r = r.parent
    }
}
function ha(e, t, n, s) {
    const r = Os(t, e, s, !0);
    Ps( () => {
        gs(s[t], r)
    }
    , n)
}
function qs(e) {
    e.shapeFlag &= -257,
    e.shapeFlag &= -513
}
function Gn(e) {
    return e.shapeFlag & 128 ? e.ssContent : e
}
function Os(e, t, n=ge, s=!1) {
    if (n) {
        const r = n[e] || (n[e] = [])
          , i = t.__weh || (t.__weh = (...o) => {
            tt();
            const l = Pt(n)
              , c = De(t, n, e, o);
            return l(),
            nt(),
            c
        }
        );
        return s ? r.unshift(i) : r.push(i),
        i
    }
}
const ot = e => (t, n=ge) => {
    (!Gt || e === "sp") && Os(e, (...s) => t(...s), n)
}
  , Jo = ot("bm")
  , Ln = ot("m")
  , jr = ot("bu")
  , Ns = ot("u")
  , Rs = ot("bum")
  , Ps = ot("um")
  , Xo = ot("sp")
  , zo = ot("rtg")
  , Zo = ot("rtc");
function Qo(e, t=ge) {
    Os("ec", e, t)
}
const $r = "components"
  , da = "directives";
function pa(e, t) {
    return Kr($r, e, !0, t) || e
}
const el = Symbol.for("v-ndc");
function ga(e) {
    return te(e) ? Kr($r, e, !1) || e : e || el
}
function ma(e) {
    return Kr(da, e)
}
function Kr(e, t, n=!0, s=!1) {
    const r = me || ge;
    if (r) {
        const i = r.type;
        if (e === $r) {
            const l = gr(i, !1);
            if (l && (l === t || l === de(t) || l === Xt(de(t))))
                return i
        }
        const o = vi(r[e] || i[e], t) || vi(r.appContext[e], t);
        return !o && s ? i : o
    }
}
function vi(e, t) {
    return e && (e[t] || e[de(t)] || e[Xt(de(t))])
}
function _a(e, t, n, s) {
    let r;
    const i = n && n[s]
      , o = V(e);
    if (o || te(e)) {
        const l = o && Be(e);
        let c = !1
          , u = !1;
        l && (c = !Le(e),
        u = st(e),
        e = Es(e)),
        r = new Array(e.length);
        for (let f = 0, h = e.length; f < h; f++)
            r[f] = t(c ? u ? Qn(pe(e[f])) : pe(e[f]) : e[f], f, void 0, i && i[f])
    } else if (typeof e == "number") {
        r = new Array(e);
        for (let l = 0; l < e; l++)
            r[l] = t(l + 1, l, void 0, i && i[l])
    } else if (ne(e))
        if (e[Symbol.iterator])
            r = Array.from(e, (l, c) => t(l, c, void 0, i && i[c]));
        else {
            const l = Object.keys(e);
            r = new Array(l.length);
            for (let c = 0, u = l.length; c < u; c++) {
                const f = l[c];
                r[c] = t(e[f], f, c, i && i[c])
            }
        }
    else
        r = [];
    return n && (n[s] = r),
    r
}
function ya(e, t) {
    for (let n = 0; n < t.length; n++) {
        const s = t[n];
        if (V(s))
            for (let r = 0; r < s.length; r++)
                e[s[r].name] = s[r].fn;
        else
            s && (e[s.name] = s.key ? (...r) => {
                const i = s.fn(...r);
                return i && (i.key = s.key),
                i
            }
            : s.fn)
    }
    return e
}
function ba(e, t, n={}, s, r) {
    if (me.ce || me.parent && dt(me.parent) && me.parent.ce)
        return t !== "default" && (n.name = t),
        xn(),
        ls(he, null, [ce("slot", n, s && s())], 64);
    let i = e[t];
    i && i._c && (i._d = !1),
    xn();
    const o = i && Wr(i(n))
      , l = n.key || o && o.key
      , c = ls(he, {
        key: (l && !ke(l) ? l : `_${t}`) + (!o && s ? "_fb" : "")
    }, o || (s ? s() : []), o && e._ === 1 ? 64 : -2);
    return !r && c.scopeId && (c.slotScopeIds = [c.scopeId + "-s"]),
    i && i._c && (i._d = !0),
    c
}
function Wr(e) {
    return e.some(t => it(t) ? !(t.type === fe || t.type === he && !Wr(t.children)) : !0) ? e : null
}
function Ea(e, t) {
    const n = {};
    for (const s in e)
        n[t && /[A-Z]/.test(s) ? `on:${s}` : Bt(s)] = e[s];
    return n
}
const ir = e => e ? Ml(e) ? In(e) : ir(e.parent) : null
  , un = re(Object.create(null), {
    $: e => e,
    $el: e => e.vnode.el,
    $data: e => e.data,
    $props: e => e.props,
    $attrs: e => e.attrs,
    $slots: e => e.slots,
    $refs: e => e.refs,
    $parent: e => ir(e.parent),
    $root: e => ir(e.root),
    $host: e => e.ce,
    $emit: e => e.emit,
    $options: e => Gr(e),
    $forceUpdate: e => e.f || (e.f = () => {
        kr(e.update)
    }
    ),
    $nextTick: e => e.n || (e.n = Pn.bind(e.proxy)),
    $watch: e => za.bind(e)
})
  , Ys = (e, t) => e !== X && !e.__isScriptSetup && Q(e, t)
  , or = {
    get({_: e}, t) {
        if (t === "__v_skip")
            return !0;
        const {ctx: n, setupState: s, data: r, props: i, accessCache: o, type: l, appContext: c} = e;
        let u;
        if (t[0] !== "$") {
            const y = o[t];
            if (y !== void 0)
                switch (y) {
                case 1:
                    return s[t];
                case 2:
                    return r[t];
                case 4:
                    return n[t];
                case 3:
                    return i[t]
                }
            else {
                if (Ys(s, t))
                    return o[t] = 1,
                    s[t];
                if (r !== X && Q(r, t))
                    return o[t] = 2,
                    r[t];
                if ((u = e.propsOptions[0]) && Q(u, t))
                    return o[t] = 3,
                    i[t];
                if (n !== X && Q(n, t))
                    return o[t] = 4,
                    n[t];
                lr && (o[t] = 0)
            }
        }
        const f = un[t];
        let h, m;
        if (f)
            return t === "$attrs" && Ee(e.attrs, "get", ""),
            f(e);
        if ((h = l.__cssModules) && (h = h[t]))
            return h;
        if (n !== X && Q(n, t))
            return o[t] = 4,
            n[t];
        if (m = c.config.globalProperties,
        Q(m, t))
            return m[t]
    },
    set({_: e}, t, n) {
        const {data: s, setupState: r, ctx: i} = e;
        return Ys(r, t) ? (r[t] = n,
        !0) : s !== X && Q(s, t) ? (s[t] = n,
        !0) : Q(e.props, t) || t[0] === "$" && t.slice(1)in e ? !1 : (i[t] = n,
        !0)
    },
    has({_: {data: e, setupState: t, accessCache: n, ctx: s, appContext: r, propsOptions: i, type: o}}, l) {
        let c, u;
        return !!(n[l] || e !== X && l[0] !== "$" && Q(e, l) || Ys(t, l) || (c = i[0]) && Q(c, l) || Q(s, l) || Q(un, l) || Q(r.config.globalProperties, l) || (u = o.__cssModules) && u[l])
    },
    defineProperty(e, t, n) {
        return n.get != null ? e._.accessCache[t] = 0 : Q(n, "value") && this.set(e, t, n.value, null),
        Reflect.defineProperty(e, t, n)
    }
}
  , va = re({}, or, {
    get(e, t) {
        if (t !== Symbol.unscopables)
            return or.get(e, t, e)
    },
    has(e, t) {
        return t[0] !== "_" && !xr(t)
    }
});
function Ta() {
    return null
}
function Ca() {
    return null
}
function Sa(e) {}
function xa(e) {}
function Aa() {
    return null
}
function wa() {}
function Oa(e, t) {
    return null
}
function Na() {
    return tl().slots
}
function Ra() {
    return tl().attrs
}
function tl(e) {
    const t = Ne();
    return t.setupContext || (t.setupContext = Il(t))
}
function Cn(e) {
    return V(e) ? e.reduce( (t, n) => (t[n] = null,
    t), {}) : e
}
function Pa(e, t) {
    const n = Cn(e);
    for (const s in t) {
        if (s.startsWith("__skip"))
            continue;
        let r = n[s];
        r ? V(r) || G(r) ? r = n[s] = {
            type: r,
            default: t[s]
        } : r.default = t[s] : r === null && (r = n[s] = {
            default: t[s]
        }),
        r && t[`__skip_${s}`] && (r.skipFactory = !0)
    }
    return n
}
function Ma(e, t) {
    return !e || !t ? e || t : V(e) && V(t) ? e.concat(t) : re({}, Cn(e), Cn(t))
}
function La(e, t) {
    const n = {};
    for (const s in e)
        t.includes(s) || Object.defineProperty(n, s, {
            enumerable: !0,
            get: () => e[s]
        });
    return n
}
function Fa(e) {
    const t = Ne();
    let n = e();
    return hr(),
    ms(n) && (n = n.catch(s => {
        throw Pt(t),
        s
    }
    )),
    [n, () => Pt(t)]
}
let lr = !0;
function Ia(e) {
    const t = Gr(e)
      , n = e.proxy
      , s = e.ctx;
    lr = !1,
    t.beforeCreate && Ti(t.beforeCreate, e, "bc");
    const {data: r, computed: i, methods: o, watch: l, provide: c, inject: u, created: f, beforeMount: h, mounted: m, beforeUpdate: y, updated: T, activated: v, deactivated: B, beforeDestroy: D, beforeUnmount: A, destroyed: p, unmounted: g, render: _, renderTracked: R, renderTriggered: F, errorCaptured: P, serverPrefetch: E, expose: C, inheritAttrs: U, components: w, directives: K, filters: z} = t;
    if (u && ka(u, s, null),
    o)
        for (const W in o) {
            const j = o[W];
            G(j) && (s[W] = j.bind(n))
        }
    if (r) {
        const W = r.call(n, n);
        ne(W) && (e.data = Rn(W))
    }
    if (lr = !0,
    i)
        for (const W in i) {
            const j = i[W]
              , ae = G(j) ? j.bind(n, n) : G(j.get) ? j.get.bind(n, n) : Me
              , kn = !G(j) && G(j.set) ? j.set.bind(n) : Me
              , _t = Fs({
                get: ae,
                set: kn
            });
            Object.defineProperty(s, W, {
                enumerable: !0,
                configurable: !0,
                get: () => _t.value,
                set: je => _t.value = je
            })
        }
    if (l)
        for (const W in l)
            nl(l[W], s, n, W);
    if (c) {
        const W = G(c) ? c.call(n) : c;
        Reflect.ownKeys(W).forEach(j => {
            rl(j, W[j])
        }
        )
    }
    f && Ti(f, e, "c");
    function H(W, j) {
        V(j) ? j.forEach(ae => W(ae.bind(n))) : j && W(j.bind(n))
    }
    if (H(Jo, h),
    H(Ln, m),
    H(jr, y),
    H(Ns, T),
    H(Go, v),
    H(qo, B),
    H(Qo, P),
    H(Zo, R),
    H(zo, F),
    H(Rs, A),
    H(Ps, g),
    H(Xo, E),
    V(C))
        if (C.length) {
            const W = e.exposed || (e.exposed = {});
            C.forEach(j => {
                Object.defineProperty(W, j, {
                    get: () => n[j],
                    set: ae => n[j] = ae,
                    enumerable: !0
                })
            }
            )
        } else
            e.exposed || (e.exposed = {});
    _ && e.render === Me && (e.render = _),
    U != null && (e.inheritAttrs = U),
    w && (e.components = w),
    K && (e.directives = K),
    E && Br(e)
}
function ka(e, t, n=Me) {
    V(e) && (e = cr(e));
    for (const s in e) {
        const r = e[s];
        let i;
        ne(r) ? "default"in r ? i = wt(r.from || s, r.default, !0) : i = wt(r.from || s) : i = wt(r),
        le(i) ? Object.defineProperty(t, s, {
            enumerable: !0,
            configurable: !0,
            get: () => i.value,
            set: o => i.value = o
        }) : t[s] = i
    }
}
function Ti(e, t, n) {
    De(V(e) ? e.map(s => s.bind(t.proxy)) : e.bind(t.proxy), t, n)
}
function nl(e, t, n, s) {
    let r = s.includes(".") ? vl(n, s) : () => n[s];
    if (te(e)) {
        const i = t[e];
        G(i) && Ot(r, i)
    } else if (G(e))
        Ot(r, e.bind(n));
    else if (ne(e))
        if (V(e))
            e.forEach(i => nl(i, t, n, s));
        else {
            const i = G(e.handler) ? e.handler.bind(n) : t[e.handler];
            G(i) && Ot(r, i, e)
        }
}
function Gr(e) {
    const t = e.type
      , {mixins: n, extends: s} = t
      , {mixins: r, optionsCache: i, config: {optionMergeStrategies: o}} = e.appContext
      , l = i.get(t);
    let c;
    return l ? c = l : !r.length && !n && !s ? c = t : (c = {},
    r.length && r.forEach(u => rs(c, u, o, !0)),
    rs(c, t, o)),
    ne(t) && i.set(t, c),
    c
}
function rs(e, t, n, s=!1) {
    const {mixins: r, extends: i} = t;
    i && rs(e, i, n, !0),
    r && r.forEach(o => rs(e, o, n, !0));
    for (const o in t)
        if (!(s && o === "expose")) {
            const l = Da[o] || n && n[o];
            e[o] = l ? l(e[o], t[o]) : t[o]
        }
    return e
}
const Da = {
    data: Ci,
    props: Si,
    emits: Si,
    methods: ln,
    computed: ln,
    beforeCreate: Ce,
    created: Ce,
    beforeMount: Ce,
    mounted: Ce,
    beforeUpdate: Ce,
    updated: Ce,
    beforeDestroy: Ce,
    beforeUnmount: Ce,
    destroyed: Ce,
    unmounted: Ce,
    activated: Ce,
    deactivated: Ce,
    errorCaptured: Ce,
    serverPrefetch: Ce,
    components: ln,
    directives: ln,
    watch: Va,
    provide: Ci,
    inject: Ha
};
function Ci(e, t) {
    return t ? e ? function() {
        return re(G(e) ? e.call(this, this) : e, G(t) ? t.call(this, this) : t)
    }
    : t : e
}
function Ha(e, t) {
    return ln(cr(e), cr(t))
}
function cr(e) {
    if (V(e)) {
        const t = {};
        for (let n = 0; n < e.length; n++)
            t[e[n]] = e[n];
        return t
    }
    return e
}
function Ce(e, t) {
    return e ? [...new Set([].concat(e, t))] : t
}
function ln(e, t) {
    return e ? re(Object.create(null), e, t) : t
}
function Si(e, t) {
    return e ? V(e) && V(t) ? [...new Set([...e, ...t])] : re(Object.create(null), Cn(e), Cn(t ?? {})) : t
}
function Va(e, t) {
    if (!e)
        return t;
    if (!t)
        return e;
    const n = re(Object.create(null), e);
    for (const s in t)
        n[s] = Ce(e[s], t[s]);
    return n
}
function sl() {
    return {
        app: null,
        config: {
            isNativeTag: Tr,
            performance: !1,
            globalProperties: {},
            optionMergeStrategies: {},
            errorHandler: void 0,
            warnHandler: void 0,
            compilerOptions: {}
        },
        mixins: [],
        components: {},
        directives: {},
        provides: Object.create(null),
        optionsCache: new WeakMap,
        propsCache: new WeakMap,
        emitsCache: new WeakMap
    }
}
let Ua = 0;
function Ba(e, t) {
    return function(s, r=null) {
        G(s) || (s = re({}, s)),
        r != null && !ne(r) && (r = null);
        const i = sl()
          , o = new WeakSet
          , l = [];
        let c = !1;
        const u = i.app = {
            _uid: Ua++,
            _component: s,
            _props: r,
            _container: null,
            _context: i,
            _instance: null,
            version: Hl,
            get config() {
                return i.config
            },
            set config(f) {},
            use(f, ...h) {
                return o.has(f) || (f && G(f.install) ? (o.add(f),
                f.install(u, ...h)) : G(f) && (o.add(f),
                f(u, ...h))),
                u
            },
            mixin(f) {
                return i.mixins.includes(f) || i.mixins.push(f),
                u
            },
            component(f, h) {
                return h ? (i.components[f] = h,
                u) : i.components[f]
            },
            directive(f, h) {
                return h ? (i.directives[f] = h,
                u) : i.directives[f]
            },
            mount(f, h, m) {
                if (!c) {
                    const y = u._ceVNode || ce(s, r);
                    return y.appContext = i,
                    m === !0 ? m = "svg" : m === !1 && (m = void 0),
                    h && t ? t(y, f) : e(y, f, m),
                    c = !0,
                    u._container = f,
                    f.__vue_app__ = u,
                    In(y.component)
                }
            },
            onUnmount(f) {
                l.push(f)
            },
            unmount() {
                c && (De(l, u._instance, 16),
                e(null, u._container),
                delete u._container.__vue_app__)
            },
            provide(f, h) {
                return i.provides[f] = h,
                u
            },
            runWithContext(f) {
                const h = At;
                At = u;
                try {
                    return f()
                } finally {
                    At = h
                }
            }
        };
        return u
    }
}
let At = null;
function rl(e, t) {
    if (ge) {
        let n = ge.provides;
        const s = ge.parent && ge.parent.provides;
        s === n && (n = ge.provides = Object.create(s)),
        n[e] = t
    }
}
function wt(e, t, n=!1) {
    const s = Ne();
    if (s || At) {
        let r = At ? At._context.provides : s ? s.parent == null || s.ce ? s.vnode.appContext && s.vnode.appContext.provides : s.parent.provides : void 0;
        if (r && e in r)
            return r[e];
        if (arguments.length > 1)
            return n && G(t) ? t.call(s && s.proxy) : t
    }
}
function qr() {
    return !!(Ne() || At)
}
const il = {}
  , ol = () => Object.create(il)
  , ll = e => Object.getPrototypeOf(e) === il;
function ja(e, t, n, s=!1) {
    const r = {}
      , i = ol();
    e.propsDefaults = Object.create(null),
    cl(e, t, r, i);
    for (const o in e.propsOptions[0])
        o in r || (r[o] = void 0);
    n ? e.props = s ? r : xo(r) : e.type.props ? e.props = r : e.props = i,
    e.attrs = i
}
function $a(e, t, n, s) {
    const {props: r, attrs: i, vnode: {patchFlag: o}} = e
      , l = J(r)
      , [c] = e.propsOptions;
    let u = !1;
    if ((s || o > 0) && !(o & 16)) {
        if (o & 8) {
            const f = e.vnode.dynamicProps;
            for (let h = 0; h < f.length; h++) {
                let m = f[h];
                if (Ms(e.emitsOptions, m))
                    continue;
                const y = t[m];
                if (c)
                    if (Q(i, m))
                        y !== i[m] && (i[m] = y,
                        u = !0);
                    else {
                        const T = de(m);
                        r[T] = fr(c, l, T, y, e, !1)
                    }
                else
                    y !== i[m] && (i[m] = y,
                    u = !0)
            }
        }
    } else {
        cl(e, t, r, i) && (u = !0);
        let f;
        for (const h in l)
            (!t || !Q(t, h) && ((f = ve(h)) === h || !Q(t, f))) && (c ? n && (n[h] !== void 0 || n[f] !== void 0) && (r[h] = fr(c, l, h, void 0, e, !0)) : delete r[h]);
        if (i !== l)
            for (const h in i)
                (!t || !Q(t, h)) && (delete i[h],
                u = !0)
    }
    u && ze(e.attrs, "set", "")
}
function cl(e, t, n, s) {
    const [r,i] = e.propsOptions;
    let o = !1, l;
    if (t)
        for (let c in t) {
            if (Tt(c))
                continue;
            const u = t[c];
            let f;
            r && Q(r, f = de(c)) ? !i || !i.includes(f) ? n[f] = u : (l || (l = {}))[f] = u : Ms(e.emitsOptions, c) || (!(c in s) || u !== s[c]) && (s[c] = u,
            o = !0)
        }
    if (i) {
        const c = J(n)
          , u = l || X;
        for (let f = 0; f < i.length; f++) {
            const h = i[f];
            n[h] = fr(r, c, h, u[h], e, !Q(u, h))
        }
    }
    return o
}
function fr(e, t, n, s, r, i) {
    const o = e[n];
    if (o != null) {
        const l = Q(o, "default");
        if (l && s === void 0) {
            const c = o.default;
            if (o.type !== Function && !o.skipFactory && G(c)) {
                const {propsDefaults: u} = r;
                if (n in u)
                    s = u[n];
                else {
                    const f = Pt(r);
                    s = u[n] = c.call(null, t),
                    f()
                }
            } else
                s = c;
            r.ce && r.ce._setProp(n, s)
        }
        o[0] && (i && !l ? s = !1 : o[1] && (s === "" || s === ve(n)) && (s = !0))
    }
    return s
}
const Ka = new WeakMap;
function fl(e, t, n=!1) {
    const s = n ? Ka : t.propsCache
      , r = s.get(e);
    if (r)
        return r;
    const i = e.props
      , o = {}
      , l = [];
    let c = !1;
    if (!G(e)) {
        const f = h => {
            c = !0;
            const [m,y] = fl(h, t, !0);
            re(o, m),
            y && l.push(...y)
        }
        ;
        !n && t.mixins.length && t.mixins.forEach(f),
        e.extends && f(e.extends),
        e.mixins && e.mixins.forEach(f)
    }
    if (!i && !c)
        return ne(e) && s.set(e, Et),
        Et;
    if (V(i))
        for (let f = 0; f < i.length; f++) {
            const h = de(i[f]);
            xi(h) && (o[h] = X)
        }
    else if (i)
        for (const f in i) {
            const h = de(f);
            if (xi(h)) {
                const m = i[f]
                  , y = o[h] = V(m) || G(m) ? {
                    type: m
                } : re({}, m)
                  , T = y.type;
                let v = !1
                  , B = !0;
                if (V(T))
                    for (let D = 0; D < T.length; ++D) {
                        const A = T[D]
                          , p = G(A) && A.name;
                        if (p === "Boolean") {
                            v = !0;
                            break
                        } else
                            p === "String" && (B = !1)
                    }
                else
                    v = G(T) && T.name === "Boolean";
                y[0] = v,
                y[1] = B,
                (v || Q(y, "default")) && l.push(h)
            }
        }
    const u = [o, l];
    return ne(e) && s.set(e, u),
    u
}
function xi(e) {
    return e[0] !== "$" && !Tt(e)
}
const Yr = e => e === "_" || e === "_ctx" || e === "$stable"
  , Jr = e => V(e) ? e.map(we) : [we(e)]
  , Wa = (e, t, n) => {
    if (t._n)
        return t;
    const s = Dr( (...r) => Jr(t(...r)), n);
    return s._c = !1,
    s
}
  , al = (e, t, n) => {
    const s = e._ctx;
    for (const r in e) {
        if (Yr(r))
            continue;
        const i = e[r];
        if (G(i))
            t[r] = Wa(r, i, s);
        else if (i != null) {
            const o = Jr(i);
            t[r] = () => o
        }
    }
}
  , ul = (e, t) => {
    const n = Jr(t);
    e.slots.default = () => n
}
  , hl = (e, t, n) => {
    for (const s in t)
        (n || !Yr(s)) && (e[s] = t[s])
}
  , Ga = (e, t, n) => {
    const s = e.slots = ol();
    if (e.vnode.shapeFlag & 32) {
        const r = t._;
        r ? (hl(s, t, n),
        n && Sr(s, "_", r, !0)) : al(t, s)
    } else
        t && ul(e, t)
}
  , qa = (e, t, n) => {
    const {vnode: s, slots: r} = e;
    let i = !0
      , o = X;
    if (s.shapeFlag & 32) {
        const l = t._;
        l ? n && l === 1 ? i = !1 : hl(r, t, n) : (i = !t.$stable,
        al(t, r)),
        o = t
    } else
        t && (ul(e, t),
        o = {
            default: 1
        });
    if (i)
        for (const l in r)
            !Yr(l) && o[l] == null && delete r[l]
}
  , ue = xl;
function dl(e) {
    return gl(e)
}
function pl(e) {
    return gl(e, Qf)
}
function gl(e, t) {
    const n = On();
    n.__VUE__ = !0;
    const {insert: s, remove: r, patchProp: i, createElement: o, createText: l, createComment: c, setText: u, setElementText: f, parentNode: h, nextSibling: m, setScopeId: y=Me, insertStaticContent: T} = e
      , v = (a, d, b, O=null, S=null, x=null, I=void 0, L=null, M=!!d.dynamicChildren) => {
        if (a === d)
            return;
        a && !Ve(a, d) && (O = Dn(a),
        je(a, S, x, !0),
        a = null),
        d.patchFlag === -2 && (M = !1,
        d.dynamicChildren = null);
        const {type: N, ref: q, shapeFlag: k} = d;
        switch (N) {
        case pt:
            B(a, d, b, O);
            break;
        case fe:
            D(a, d, b, O);
            break;
        case Nt:
            a == null && A(d, b, O, I);
            break;
        case he:
            w(a, d, b, O, S, x, I, L, M);
            break;
        default:
            k & 1 ? _(a, d, b, O, S, x, I, L, M) : k & 6 ? K(a, d, b, O, S, x, I, L, M) : (k & 64 || k & 128) && N.process(a, d, b, O, S, x, I, L, M, Ft)
        }
        q != null && S ? $t(q, a && a.ref, x, d || a, !d) : q == null && a && a.ref != null && $t(a.ref, null, x, a, !0)
    }
      , B = (a, d, b, O) => {
        if (a == null)
            s(d.el = l(d.children), b, O);
        else {
            const S = d.el = a.el;
            d.children !== a.children && u(S, d.children)
        }
    }
      , D = (a, d, b, O) => {
        a == null ? s(d.el = c(d.children || ""), b, O) : d.el = a.el
    }
      , A = (a, d, b, O) => {
        [a.el,a.anchor] = T(a.children, d, b, O, a.el, a.anchor)
    }
      , p = ({el: a, anchor: d}, b, O) => {
        let S;
        for (; a && a !== d; )
            S = m(a),
            s(a, b, O),
            a = S;
        s(d, b, O)
    }
      , g = ({el: a, anchor: d}) => {
        let b;
        for (; a && a !== d; )
            b = m(a),
            r(a),
            a = b;
        r(d)
    }
      , _ = (a, d, b, O, S, x, I, L, M) => {
        d.type === "svg" ? I = "svg" : d.type === "math" && (I = "mathml"),
        a == null ? R(d, b, O, S, x, I, L, M) : E(a, d, S, x, I, L, M)
    }
      , R = (a, d, b, O, S, x, I, L) => {
        let M, N;
        const {props: q, shapeFlag: k, transition: $, dirs: Y} = a;
        if (M = a.el = o(a.type, x, q && q.is, q),
        k & 8 ? f(M, a.children) : k & 16 && P(a.children, M, null, O, S, Js(a, x), I, L),
        Y && Ge(a, null, O, "created"),
        F(M, a, a.scopeId, I, O),
        q) {
            for (const ie in q)
                ie !== "value" && !Tt(ie) && i(M, ie, null, q[ie], x, O);
            "value"in q && i(M, "value", null, q.value, x),
            (N = q.onVnodeBeforeMount) && Ae(N, O, a)
        }
        Y && Ge(a, null, O, "beforeMount");
        const Z = ml(S, $);
        Z && $.beforeEnter(M),
        s(M, d, b),
        ((N = q && q.onVnodeMounted) || Z || Y) && ue( () => {
            N && Ae(N, O, a),
            Z && $.enter(M),
            Y && Ge(a, null, O, "mounted")
        }
        , S)
    }
      , F = (a, d, b, O, S) => {
        if (b && y(a, b),
        O)
            for (let x = 0; x < O.length; x++)
                y(a, O[x]);
        if (S) {
            let x = S.subTree;
            if (d === x || os(x.type) && (x.ssContent === d || x.ssFallback === d)) {
                const I = S.vnode;
                F(a, I, I.scopeId, I.slotScopeIds, S.parent)
            }
        }
    }
      , P = (a, d, b, O, S, x, I, L, M=0) => {
        for (let N = M; N < a.length; N++) {
            const q = a[N] = L ? ht(a[N]) : we(a[N]);
            v(null, q, d, b, O, S, x, I, L)
        }
    }
      , E = (a, d, b, O, S, x, I) => {
        const L = d.el = a.el;
        let {patchFlag: M, dynamicChildren: N, dirs: q} = d;
        M |= a.patchFlag & 16;
        const k = a.props || X
          , $ = d.props || X;
        let Y;
        if (b && yt(b, !1),
        (Y = $.onVnodeBeforeUpdate) && Ae(Y, b, d, a),
        q && Ge(d, a, b, "beforeUpdate"),
        b && yt(b, !0),
        (k.innerHTML && $.innerHTML == null || k.textContent && $.textContent == null) && f(L, ""),
        N ? C(a.dynamicChildren, N, L, b, O, Js(d, S), x) : I || j(a, d, L, null, b, O, Js(d, S), x, !1),
        M > 0) {
            if (M & 16)
                U(L, k, $, b, S);
            else if (M & 2 && k.class !== $.class && i(L, "class", null, $.class, S),
            M & 4 && i(L, "style", k.style, $.style, S),
            M & 8) {
                const Z = d.dynamicProps;
                for (let ie = 0; ie < Z.length; ie++) {
                    const ee = Z[ie]
                      , xe = k[ee]
                      , _e = $[ee];
                    (_e !== xe || ee === "value") && i(L, ee, xe, _e, S, b)
                }
            }
            M & 1 && a.children !== d.children && f(L, d.children)
        } else
            !I && N == null && U(L, k, $, b, S);
        ((Y = $.onVnodeUpdated) || q) && ue( () => {
            Y && Ae(Y, b, d, a),
            q && Ge(d, a, b, "updated")
        }
        , O)
    }
      , C = (a, d, b, O, S, x, I) => {
        for (let L = 0; L < d.length; L++) {
            const M = a[L]
              , N = d[L]
              , q = M.el && (M.type === he || !Ve(M, N) || M.shapeFlag & 198) ? h(M.el) : b;
            v(M, N, q, null, O, S, x, I, !0)
        }
    }
      , U = (a, d, b, O, S) => {
        if (d !== b) {
            if (d !== X)
                for (const x in d)
                    !Tt(x) && !(x in b) && i(a, x, d[x], null, S, O);
            for (const x in b) {
                if (Tt(x))
                    continue;
                const I = b[x]
                  , L = d[x];
                I !== L && x !== "value" && i(a, x, L, I, S, O)
            }
            "value"in b && i(a, "value", d.value, b.value, S)
        }
    }
      , w = (a, d, b, O, S, x, I, L, M) => {
        const N = d.el = a ? a.el : l("")
          , q = d.anchor = a ? a.anchor : l("");
        let {patchFlag: k, dynamicChildren: $, slotScopeIds: Y} = d;
        Y && (L = L ? L.concat(Y) : Y),
        a == null ? (s(N, b, O),
        s(q, b, O),
        P(d.children || [], b, q, S, x, I, L, M)) : k > 0 && k & 64 && $ && a.dynamicChildren ? (C(a.dynamicChildren, $, b, S, x, I, L),
        (d.key != null || S && d === S.subTree) && Xr(a, d, !0)) : j(a, d, b, q, S, x, I, L, M)
    }
      , K = (a, d, b, O, S, x, I, L, M) => {
        d.slotScopeIds = L,
        a == null ? d.shapeFlag & 512 ? S.ctx.activate(d, b, O, I, M) : z(d, b, O, S, x, I, M) : se(a, d, M)
    }
      , z = (a, d, b, O, S, x, I) => {
        const L = a.component = Pl(a, O, S);
        if (Mn(a) && (L.ctx.renderer = Ft),
        Ll(L, !1, I),
        L.asyncDep) {
            if (S && S.registerDep(L, H, I),
            !a.el) {
                const M = L.subTree = ce(fe);
                D(null, M, d, b),
                a.placeholder = M.el
            }
        } else
            H(L, a, d, b, S, x, I)
    }
      , se = (a, d, b) => {
        const O = d.component = a.component;
        if (ru(a, d, b))
            if (O.asyncDep && !O.asyncResolved) {
                W(O, d, b);
                return
            } else
                O.next = d,
                O.update();
        else
            d.el = a.el,
            O.vnode = d
    }
      , H = (a, d, b, O, S, x, I) => {
        const L = () => {
            if (a.isMounted) {
                let {next: k, bu: $, u: Y, parent: Z, vnode: ie} = a;
                {
                    const Re = _l(a);
                    if (Re) {
                        k && (k.el = ie.el,
                        W(a, k, I)),
                        Re.asyncDep.then( () => {
                            a.isUnmounted || L()
                        }
                        );
                        return
                    }
                }
                let ee = k, xe;
                yt(a, !1),
                k ? (k.el = ie.el,
                W(a, k, I)) : k = ie,
                $ && Ct($),
                (xe = k.props && k.props.onVnodeBeforeUpdate) && Ae(xe, Z, k, ie),
                yt(a, !0);
                const _e = Jn(a)
                  , He = a.subTree;
                a.subTree = _e,
                v(He, _e, h(He.el), Dn(He), a, S, x),
                k.el = _e.el,
                ee === null && Ls(a, _e.el),
                Y && ue(Y, S),
                (xe = k.props && k.props.onVnodeUpdated) && ue( () => Ae(xe, Z, k, ie), S)
            } else {
                let k;
                const {el: $, props: Y} = d
                  , {bm: Z, m: ie, parent: ee, root: xe, type: _e} = a
                  , He = dt(d);
                if (yt(a, !1),
                Z && Ct(Z),
                !He && (k = Y && Y.onVnodeBeforeMount) && Ae(k, ee, d),
                yt(a, !0),
                $ && Vs) {
                    const Re = () => {
                        a.subTree = Jn(a),
                        Vs($, a.subTree, a, S, null)
                    }
                    ;
                    He && _e.__asyncHydrate ? _e.__asyncHydrate($, a, Re) : Re()
                } else {
                    xe.ce && xe.ce._def.shadowRoot !== !1 && xe.ce._injectChildStyle(_e);
                    const Re = a.subTree = Jn(a);
                    v(null, Re, b, O, a, S, x),
                    d.el = Re.el
                }
                if (ie && ue(ie, S),
                !He && (k = Y && Y.onVnodeMounted)) {
                    const Re = d;
                    ue( () => Ae(k, ee, Re), S)
                }
                (d.shapeFlag & 256 || ee && dt(ee.vnode) && ee.vnode.shapeFlag & 256) && a.a && ue(a.a, S),
                a.isMounted = !0,
                d = b = O = null
            }
        }
        ;
        a.scope.on();
        const M = a.effect = new _n(L);
        a.scope.off();
        const N = a.update = M.run.bind(M)
          , q = a.job = M.runIfDirty.bind(M);
        q.i = a,
        q.id = a.uid,
        M.scheduler = () => kr(q),
        yt(a, !0),
        N()
    }
      , W = (a, d, b) => {
        d.component = a;
        const O = a.vnode.props;
        a.vnode = d,
        a.next = null,
        $a(a, d.props, O, b),
        qa(a, d.children, b),
        tt(),
        di(a),
        nt()
    }
      , j = (a, d, b, O, S, x, I, L, M=!1) => {
        const N = a && a.children
          , q = a ? a.shapeFlag : 0
          , k = d.children
          , {patchFlag: $, shapeFlag: Y} = d;
        if ($ > 0) {
            if ($ & 128) {
                kn(N, k, b, O, S, x, I, L, M);
                return
            } else if ($ & 256) {
                ae(N, k, b, O, S, x, I, L, M);
                return
            }
        }
        Y & 8 ? (q & 16 && en(N, S, x),
        k !== N && f(b, k)) : q & 16 ? Y & 16 ? kn(N, k, b, O, S, x, I, L, M) : en(N, S, x, !0) : (q & 8 && f(b, ""),
        Y & 16 && P(k, b, O, S, x, I, L, M))
    }
      , ae = (a, d, b, O, S, x, I, L, M) => {
        a = a || Et,
        d = d || Et;
        const N = a.length
          , q = d.length
          , k = Math.min(N, q);
        let $;
        for ($ = 0; $ < k; $++) {
            const Y = d[$] = M ? ht(d[$]) : we(d[$]);
            v(a[$], Y, b, null, S, x, I, L, M)
        }
        N > q ? en(a, S, x, !0, !1, k) : P(d, b, O, S, x, I, L, M, k)
    }
      , kn = (a, d, b, O, S, x, I, L, M) => {
        let N = 0;
        const q = d.length;
        let k = a.length - 1
          , $ = q - 1;
        for (; N <= k && N <= $; ) {
            const Y = a[N]
              , Z = d[N] = M ? ht(d[N]) : we(d[N]);
            if (Ve(Y, Z))
                v(Y, Z, b, null, S, x, I, L, M);
            else
                break;
            N++
        }
        for (; N <= k && N <= $; ) {
            const Y = a[k]
              , Z = d[$] = M ? ht(d[$]) : we(d[$]);
            if (Ve(Y, Z))
                v(Y, Z, b, null, S, x, I, L, M);
            else
                break;
            k--,
            $--
        }
        if (N > k) {
            if (N <= $) {
                const Y = $ + 1
                  , Z = Y < q ? d[Y].el : O;
                for (; N <= $; )
                    v(null, d[N] = M ? ht(d[N]) : we(d[N]), b, Z, S, x, I, L, M),
                    N++
            }
        } else if (N > $)
            for (; N <= k; )
                je(a[N], S, x, !0),
                N++;
        else {
            const Y = N
              , Z = N
              , ie = new Map;
            for (N = Z; N <= $; N++) {
                const Pe = d[N] = M ? ht(d[N]) : we(d[N]);
                Pe.key != null && ie.set(Pe.key, N)
            }
            let ee, xe = 0;
            const _e = $ - Z + 1;
            let He = !1
              , Re = 0;
            const tn = new Array(_e);
            for (N = 0; N < _e; N++)
                tn[N] = 0;
            for (N = Y; N <= k; N++) {
                const Pe = a[N];
                if (xe >= _e) {
                    je(Pe, S, x, !0);
                    continue
                }
                let $e;
                if (Pe.key != null)
                    $e = ie.get(Pe.key);
                else
                    for (ee = Z; ee <= $; ee++)
                        if (tn[ee - Z] === 0 && Ve(Pe, d[ee])) {
                            $e = ee;
                            break
                        }
                $e === void 0 ? je(Pe, S, x, !0) : (tn[$e - Z] = N + 1,
                $e >= Re ? Re = $e : He = !0,
                v(Pe, d[$e], b, null, S, x, I, L, M),
                xe++)
            }
            const oi = He ? Ya(tn) : Et;
            for (ee = oi.length - 1,
            N = _e - 1; N >= 0; N--) {
                const Pe = Z + N
                  , $e = d[Pe]
                  , li = d[Pe + 1]
                  , ci = Pe + 1 < q ? li.el || li.placeholder : O;
                tn[N] === 0 ? v(null, $e, b, ci, S, x, I, L, M) : He && (ee < 0 || N !== oi[ee] ? _t($e, b, ci, 2) : ee--)
            }
        }
    }
      , _t = (a, d, b, O, S=null) => {
        const {el: x, type: I, transition: L, children: M, shapeFlag: N} = a;
        if (N & 6) {
            _t(a.component.subTree, d, b, O);
            return
        }
        if (N & 128) {
            a.suspense.move(d, b, O);
            return
        }
        if (N & 64) {
            I.move(a, d, b, Ft);
            return
        }
        if (I === he) {
            s(x, d, b);
            for (let k = 0; k < M.length; k++)
                _t(M[k], d, b, O);
            s(a.anchor, d, b);
            return
        }
        if (I === Nt) {
            p(a, d, b);
            return
        }
        if (O !== 2 && N & 1 && L)
            if (O === 0)
                L.beforeEnter(x),
                s(x, d, b),
                ue( () => L.enter(x), S);
            else {
                const {leave: k, delayLeave: $, afterLeave: Y} = L
                  , Z = () => {
                    a.ctx.isUnmounted ? r(x) : s(x, d, b)
                }
                  , ie = () => {
                    x._isLeaving && x[Xe](!0),
                    k(x, () => {
                        Z(),
                        Y && Y()
                    }
                    )
                }
                ;
                $ ? $(x, Z, ie) : ie()
            }
        else
            s(x, d, b)
    }
      , je = (a, d, b, O=!1, S=!1) => {
        const {type: x, props: I, ref: L, children: M, dynamicChildren: N, shapeFlag: q, patchFlag: k, dirs: $, cacheIndex: Y} = a;
        if (k === -2 && (S = !1),
        L != null && (tt(),
        $t(L, null, b, a, !0),
        nt()),
        Y != null && (d.renderCache[Y] = void 0),
        q & 256) {
            d.ctx.deactivate(a);
            return
        }
        const Z = q & 1 && $
          , ie = !dt(a);
        let ee;
        if (ie && (ee = I && I.onVnodeBeforeUnmount) && Ae(ee, d, a),
        q & 6)
            uc(a.component, b, O);
        else {
            if (q & 128) {
                a.suspense.unmount(b, O);
                return
            }
            Z && Ge(a, null, d, "beforeUnmount"),
            q & 64 ? a.type.remove(a, d, b, Ft, O) : N && !N.hasOnce && (x !== he || k > 0 && k & 64) ? en(N, d, b, !1, !0) : (x === he && k & 384 || !S && q & 16) && en(M, d, b),
            O && ri(a)
        }
        (ie && (ee = I && I.onVnodeUnmounted) || Z) && ue( () => {
            ee && Ae(ee, d, a),
            Z && Ge(a, null, d, "unmounted")
        }
        , b)
    }
      , ri = a => {
        const {type: d, el: b, anchor: O, transition: S} = a;
        if (d === he) {
            ac(b, O);
            return
        }
        if (d === Nt) {
            g(a);
            return
        }
        const x = () => {
            r(b),
            S && !S.persisted && S.afterLeave && S.afterLeave()
        }
        ;
        if (a.shapeFlag & 1 && S && !S.persisted) {
            const {leave: I, delayLeave: L} = S
              , M = () => I(b, x);
            L ? L(a.el, x, M) : M()
        } else
            x()
    }
      , ac = (a, d) => {
        let b;
        for (; a !== d; )
            b = m(a),
            r(a),
            a = b;
        r(d)
    }
      , uc = (a, d, b) => {
        const {bum: O, scope: S, job: x, subTree: I, um: L, m: M, a: N} = a;
        is(M),
        is(N),
        O && Ct(O),
        S.stop(),
        x && (x.flags |= 8,
        je(I, a, d, b)),
        L && ue(L, d),
        ue( () => {
            a.isUnmounted = !0
        }
        , d)
    }
      , en = (a, d, b, O=!1, S=!1, x=0) => {
        for (let I = x; I < a.length; I++)
            je(a[I], d, b, O, S)
    }
      , Dn = a => {
        if (a.shapeFlag & 6)
            return Dn(a.component.subTree);
        if (a.shapeFlag & 128)
            return a.suspense.next();
        const d = m(a.anchor || a.el)
          , b = d && d[Ho];
        return b ? m(b) : d
    }
    ;
    let Ds = !1;
    const ii = (a, d, b) => {
        a == null ? d._vnode && je(d._vnode, null, null, !0) : v(d._vnode || null, a, d, null, null, null, b),
        d._vnode = a,
        Ds || (Ds = !0,
        di(),
        ns(),
        Ds = !1)
    }
      , Ft = {
        p: v,
        um: je,
        m: _t,
        r: ri,
        mt: z,
        mc: P,
        pc: j,
        pbc: C,
        n: Dn,
        o: e
    };
    let Hs, Vs;
    return t && ([Hs,Vs] = t(Ft)),
    {
        render: ii,
        hydrate: Hs,
        createApp: Ba(ii, Hs)
    }
}
function Js({type: e, props: t}, n) {
    return n === "svg" && e === "foreignObject" || n === "mathml" && e === "annotation-xml" && t && t.encoding && t.encoding.includes("html") ? void 0 : n
}
function yt({effect: e, job: t}, n) {
    n ? (e.flags |= 32,
    t.flags |= 4) : (e.flags &= -33,
    t.flags &= -5)
}
function ml(e, t) {
    return (!e || e && !e.pendingBranch) && t && !t.persisted
}
function Xr(e, t, n=!1) {
    const s = e.children
      , r = t.children;
    if (V(s) && V(r))
        for (let i = 0; i < s.length; i++) {
            const o = s[i];
            let l = r[i];
            l.shapeFlag & 1 && !l.dynamicChildren && ((l.patchFlag <= 0 || l.patchFlag === 32) && (l = r[i] = ht(r[i]),
            l.el = o.el),
            !n && l.patchFlag !== -2 && Xr(o, l)),
            l.type === pt && l.patchFlag !== -1 && (l.el = o.el),
            l.type === fe && !l.el && (l.el = o.el)
        }
}
function Ya(e) {
    const t = e.slice()
      , n = [0];
    let s, r, i, o, l;
    const c = e.length;
    for (s = 0; s < c; s++) {
        const u = e[s];
        if (u !== 0) {
            if (r = n[n.length - 1],
            e[r] < u) {
                t[s] = r,
                n.push(s);
                continue
            }
            for (i = 0,
            o = n.length - 1; i < o; )
                l = i + o >> 1,
                e[n[l]] < u ? i = l + 1 : o = l;
            u < e[n[i]] && (i > 0 && (t[s] = n[i - 1]),
            n[i] = s)
        }
    }
    for (i = n.length,
    o = n[i - 1]; i-- > 0; )
        n[i] = o,
        o = t[o];
    return n
}
function _l(e) {
    const t = e.subTree.component;
    if (t)
        return t.asyncDep && !t.asyncResolved ? t : _l(t)
}
function is(e) {
    if (e)
        for (let t = 0; t < e.length; t++)
            e[t].flags |= 8
}
const yl = Symbol.for("v-scx")
  , bl = () => wt(yl);
function Ja(e, t) {
    return Fn(e, null, t)
}
function Xa(e, t) {
    return Fn(e, null, {
        flush: "post"
    })
}
function El(e, t) {
    return Fn(e, null, {
        flush: "sync"
    })
}
function Ot(e, t, n) {
    return Fn(e, t, n)
}
function Fn(e, t, n=X) {
    const {immediate: s, deep: r, flush: i, once: o} = n
      , l = re({}, n)
      , c = t && s || !t && i !== "post";
    let u;
    if (Gt) {
        if (i === "sync") {
            const y = bl();
            u = y.__watcherHandles || (y.__watcherHandles = [])
        } else if (!c) {
            const y = () => {}
            ;
            return y.stop = Me,
            y.resume = Me,
            y.pause = Me,
            y
        }
    }
    const f = ge;
    l.call = (y, T, v) => De(y, f, T, v);
    let h = !1;
    i === "post" ? l.scheduler = y => {
        ue(y, f && f.suspense)
    }
    : i !== "sync" && (h = !0,
    l.scheduler = (y, T) => {
        T ? y() : kr(y)
    }
    ),
    l.augmentJob = y => {
        t && (y.flags |= 4),
        h && (y.flags |= 2,
        f && (y.id = f.uid,
        y.i = f))
    }
    ;
    const m = Ff(e, t, l);
    return Gt && (u ? u.push(m) : c && m()),
    m
}
function za(e, t, n) {
    const s = this.proxy
      , r = te(e) ? e.includes(".") ? vl(s, e) : () => s[e] : e.bind(s, s);
    let i;
    G(t) ? i = t : (i = t.handler,
    n = t);
    const o = Pt(this)
      , l = Fn(r, i.bind(s), n);
    return o(),
    l
}
function vl(e, t) {
    const n = t.split(".");
    return () => {
        let s = e;
        for (let r = 0; r < n.length && s; r++)
            s = s[n[r]];
        return s
    }
}
function Za(e, t, n=X) {
    const s = Ne()
      , r = de(t)
      , i = ve(t)
      , o = Tl(e, r)
      , l = Oo( (c, u) => {
        let f, h = X, m;
        return El( () => {
            const y = e[r];
            be(f, y) && (f = y,
            u())
        }
        ),
        {
            get() {
                return c(),
                n.get ? n.get(f) : f
            },
            set(y) {
                const T = n.set ? n.set(y) : y;
                if (!be(T, f) && !(h !== X && be(y, h)))
                    return;
                const v = s.vnode.props;
                v && (t in v || r in v || i in v) && (`onUpdate:${t}`in v || `onUpdate:${r}`in v || `onUpdate:${i}`in v) || (f = y,
                u()),
                s.emit(`update:${t}`, T),
                be(y, T) && be(y, h) && !be(T, m) && u(),
                h = y,
                m = T
            }
        }
    }
    );
    return l[Symbol.iterator] = () => {
        let c = 0;
        return {
            next() {
                return c < 2 ? {
                    value: c++ ? o || X : l,
                    done: !1
                } : {
                    done: !0
                }
            }
        }
    }
    ,
    l
}
const Tl = (e, t) => t === "modelValue" || t === "model-value" ? e.modelModifiers : e[`${t}Modifiers`] || e[`${de(t)}Modifiers`] || e[`${ve(t)}Modifiers`];
function Qa(e, t, ...n) {
    if (e.isUnmounted)
        return;
    const s = e.vnode.props || X;
    let r = n;
    const i = t.startsWith("update:")
      , o = i && Tl(s, t.slice(7));
    o && (o.trim && (r = n.map(f => te(f) ? f.trim() : f)),
    o.number && (r = n.map(gn)));
    let l, c = s[l = Bt(t)] || s[l = Bt(de(t))];
    !c && i && (c = s[l = Bt(ve(t))]),
    c && De(c, e, 6, r);
    const u = s[l + "Once"];
    if (u) {
        if (!e.emitted)
            e.emitted = {};
        else if (e.emitted[l])
            return;
        e.emitted[l] = !0,
        De(u, e, 6, r)
    }
}
const eu = new WeakMap;
function Cl(e, t, n=!1) {
    const s = n ? eu : t.emitsCache
      , r = s.get(e);
    if (r !== void 0)
        return r;
    const i = e.emits;
    let o = {}
      , l = !1;
    if (!G(e)) {
        const c = u => {
            const f = Cl(u, t, !0);
            f && (l = !0,
            re(o, f))
        }
        ;
        !n && t.mixins.length && t.mixins.forEach(c),
        e.extends && c(e.extends),
        e.mixins && e.mixins.forEach(c)
    }
    return !i && !l ? (ne(e) && s.set(e, null),
    null) : (V(i) ? i.forEach(c => o[c] = null) : re(o, i),
    ne(e) && s.set(e, o),
    o)
}
function Ms(e, t) {
    return !e || !Jt(t) ? !1 : (t = t.slice(2).replace(/Once$/, ""),
    Q(e, t[0].toLowerCase() + t.slice(1)) || Q(e, ve(t)) || Q(e, t))
}
function Jn(e) {
    const {type: t, vnode: n, proxy: s, withProxy: r, propsOptions: [i], slots: o, attrs: l, emit: c, render: u, renderCache: f, props: h, data: m, setupState: y, ctx: T, inheritAttrs: v} = e
      , B = Tn(e);
    let D, A;
    try {
        if (n.shapeFlag & 4) {
            const g = r || s
              , _ = g;
            D = we(u.call(_, g, f, h, y, m, T)),
            A = l
        } else {
            const g = t;
            D = we(g.length > 1 ? g(h, {
                attrs: l,
                slots: o,
                emit: c
            }) : g(h, null)),
            A = t.props ? l : nu(l)
        }
    } catch (g) {
        hn.length = 0,
        Lt(g, e, 1),
        D = ce(fe)
    }
    let p = D;
    if (A && v !== !1) {
        const g = Object.keys(A)
          , {shapeFlag: _} = p;
        g.length && _ & 7 && (i && g.some(ps) && (A = su(A, i)),
        p = qe(p, A, !1, !0))
    }
    return n.dirs && (p = qe(p, null, !1, !0),
    p.dirs = p.dirs ? p.dirs.concat(n.dirs) : n.dirs),
    n.transition && rt(p, n.transition),
    D = p,
    Tn(B),
    D
}
function tu(e, t=!0) {
    let n;
    for (let s = 0; s < e.length; s++) {
        const r = e[s];
        if (it(r)) {
            if (r.type !== fe || r.children === "v-if") {
                if (n)
                    return;
                n = r
            }
        } else
            return
    }
    return n
}
const nu = e => {
    let t;
    for (const n in e)
        (n === "class" || n === "style" || Jt(n)) && ((t || (t = {}))[n] = e[n]);
    return t
}
  , su = (e, t) => {
    const n = {};
    for (const s in e)
        (!ps(s) || !(s.slice(9)in t)) && (n[s] = e[s]);
    return n
}
;
function ru(e, t, n) {
    const {props: s, children: r, component: i} = e
      , {props: o, children: l, patchFlag: c} = t
      , u = i.emitsOptions;
    if (t.dirs || t.transition)
        return !0;
    if (n && c >= 0) {
        if (c & 1024)
            return !0;
        if (c & 16)
            return s ? Ai(s, o, u) : !!o;
        if (c & 8) {
            const f = t.dynamicProps;
            for (let h = 0; h < f.length; h++) {
                const m = f[h];
                if (o[m] !== s[m] && !Ms(u, m))
                    return !0
            }
        }
    } else
        return (r || l) && (!l || !l.$stable) ? !0 : s === o ? !1 : s ? o ? Ai(s, o, u) : !0 : !!o;
    return !1
}
function Ai(e, t, n) {
    const s = Object.keys(t);
    if (s.length !== Object.keys(e).length)
        return !0;
    for (let r = 0; r < s.length; r++) {
        const i = s[r];
        if (t[i] !== e[i] && !Ms(n, i))
            return !0
    }
    return !1
}
function Ls({vnode: e, parent: t}, n) {
    for (; t; ) {
        const s = t.subTree;
        if (s.suspense && s.suspense.activeBranch === e && (s.el = e.el),
        s === e)
            (e = t.vnode).el = n,
            t = t.parent;
        else
            break
    }
}
const os = e => e.__isSuspense;
let ar = 0;
const iu = {
    name: "Suspense",
    __isSuspense: !0,
    process(e, t, n, s, r, i, o, l, c, u) {
        if (e == null)
            lu(t, n, s, r, i, o, l, c, u);
        else {
            if (i && i.deps > 0 && !e.suspense.isInFallback) {
                t.suspense = e.suspense,
                t.suspense.vnode = t,
                t.el = e.el;
                return
            }
            cu(e, t, n, s, r, o, l, c, u)
        }
    },
    hydrate: fu,
    normalize: au
}
  , ou = iu;
function Sn(e, t) {
    const n = e.props && e.props[t];
    G(n) && n()
}
function lu(e, t, n, s, r, i, o, l, c) {
    const {p: u, o: {createElement: f}} = c
      , h = f("div")
      , m = e.suspense = Sl(e, r, s, t, h, n, i, o, l, c);
    u(null, m.pendingBranch = e.ssContent, h, null, s, m, i, o),
    m.deps > 0 ? (Sn(e, "onPending"),
    Sn(e, "onFallback"),
    u(null, e.ssFallback, t, n, s, null, i, o),
    Kt(m, e.ssFallback)) : m.resolve(!1, !0)
}
function cu(e, t, n, s, r, i, o, l, {p: c, um: u, o: {createElement: f}}) {
    const h = t.suspense = e.suspense;
    h.vnode = t,
    t.el = e.el;
    const m = t.ssContent
      , y = t.ssFallback
      , {activeBranch: T, pendingBranch: v, isInFallback: B, isHydrating: D} = h;
    if (v)
        h.pendingBranch = m,
        Ve(v, m) ? (c(v, m, h.hiddenContainer, null, r, h, i, o, l),
        h.deps <= 0 ? h.resolve() : B && (D || (c(T, y, n, s, r, null, i, o, l),
        Kt(h, y)))) : (h.pendingId = ar++,
        D ? (h.isHydrating = !1,
        h.activeBranch = v) : u(v, r, h),
        h.deps = 0,
        h.effects.length = 0,
        h.hiddenContainer = f("div"),
        B ? (c(null, m, h.hiddenContainer, null, r, h, i, o, l),
        h.deps <= 0 ? h.resolve() : (c(T, y, n, s, r, null, i, o, l),
        Kt(h, y))) : T && Ve(T, m) ? (c(T, m, n, s, r, h, i, o, l),
        h.resolve(!0)) : (c(null, m, h.hiddenContainer, null, r, h, i, o, l),
        h.deps <= 0 && h.resolve()));
    else if (T && Ve(T, m))
        c(T, m, n, s, r, h, i, o, l),
        Kt(h, m);
    else if (Sn(t, "onPending"),
    h.pendingBranch = m,
    m.shapeFlag & 512 ? h.pendingId = m.component.suspenseId : h.pendingId = ar++,
    c(null, m, h.hiddenContainer, null, r, h, i, o, l),
    h.deps <= 0)
        h.resolve();
    else {
        const {timeout: A, pendingId: p} = h;
        A > 0 ? setTimeout( () => {
            h.pendingId === p && h.fallback(y)
        }
        , A) : A === 0 && h.fallback(y)
    }
}
function Sl(e, t, n, s, r, i, o, l, c, u, f=!1) {
    const {p: h, m, um: y, n: T, o: {parentNode: v, remove: B}} = u;
    let D;
    const A = uu(e);
    A && t && t.pendingBranch && (D = t.pendingId,
    t.deps++);
    const p = e.props ? mn(e.props.timeout) : void 0
      , g = i
      , _ = {
        vnode: e,
        parent: t,
        parentComponent: n,
        namespace: o,
        container: s,
        hiddenContainer: r,
        deps: 0,
        pendingId: ar++,
        timeout: typeof p == "number" ? p : -1,
        activeBranch: null,
        pendingBranch: null,
        isInFallback: !f,
        isHydrating: f,
        isUnmounted: !1,
        effects: [],
        resolve(R=!1, F=!1) {
            const {vnode: P, activeBranch: E, pendingBranch: C, pendingId: U, effects: w, parentComponent: K, container: z} = _;
            let se = !1;
            _.isHydrating ? _.isHydrating = !1 : R || (se = E && C.transition && C.transition.mode === "out-in",
            se && (E.transition.afterLeave = () => {
                U === _.pendingId && (m(C, z, i === g ? T(E) : i, 0),
                En(w))
            }
            ),
            E && (v(E.el) === z && (i = T(E)),
            y(E, K, _, !0)),
            se || m(C, z, i, 0)),
            Kt(_, C),
            _.pendingBranch = null,
            _.isInFallback = !1;
            let H = _.parent
              , W = !1;
            for (; H; ) {
                if (H.pendingBranch) {
                    H.effects.push(...w),
                    W = !0;
                    break
                }
                H = H.parent
            }
            !W && !se && En(w),
            _.effects = [],
            A && t && t.pendingBranch && D === t.pendingId && (t.deps--,
            t.deps === 0 && !F && t.resolve()),
            Sn(P, "onResolve")
        },
        fallback(R) {
            if (!_.pendingBranch)
                return;
            const {vnode: F, activeBranch: P, parentComponent: E, container: C, namespace: U} = _;
            Sn(F, "onFallback");
            const w = T(P)
              , K = () => {
                _.isInFallback && (h(null, R, C, w, E, null, U, l, c),
                Kt(_, R))
            }
              , z = R.transition && R.transition.mode === "out-in";
            z && (P.transition.afterLeave = K),
            _.isInFallback = !0,
            y(P, E, null, !0),
            z || K()
        },
        move(R, F, P) {
            _.activeBranch && m(_.activeBranch, R, F, P),
            _.container = R
        },
        next() {
            return _.activeBranch && T(_.activeBranch)
        },
        registerDep(R, F, P) {
            const E = !!_.pendingBranch;
            E && _.deps++;
            const C = R.vnode.el;
            R.asyncDep.catch(U => {
                Lt(U, R, 0)
            }
            ).then(U => {
                if (R.isUnmounted || _.isUnmounted || _.pendingId !== R.suspenseId)
                    return;
                R.asyncResolved = !0;
                const {vnode: w} = R;
                dr(R, U, !1),
                C && (w.el = C);
                const K = !C && R.subTree.el;
                F(R, w, v(C || R.subTree.el), C ? null : T(R.subTree), _, o, P),
                K && B(K),
                Ls(R, w.el),
                E && --_.deps === 0 && _.resolve()
            }
            )
        },
        unmount(R, F) {
            _.isUnmounted = !0,
            _.activeBranch && y(_.activeBranch, n, R, F),
            _.pendingBranch && y(_.pendingBranch, n, R, F)
        }
    };
    return _
}
function fu(e, t, n, s, r, i, o, l, c) {
    const u = t.suspense = Sl(t, s, n, e.parentNode, document.createElement("div"), null, r, i, o, l, !0)
      , f = c(e, u.pendingBranch = t.ssContent, n, u, i, o);
    return u.deps === 0 && u.resolve(!1, !0),
    f
}
function au(e) {
    const {shapeFlag: t, children: n} = e
      , s = t & 32;
    e.ssContent = wi(s ? n.default : n),
    e.ssFallback = s ? wi(n.fallback) : ce(fe)
}
function wi(e) {
    let t;
    if (G(e)) {
        const n = Rt && e._c;
        n && (e._d = !1,
        xn()),
        e = e(),
        n && (e._d = !0,
        t = Te,
        Al())
    }
    return V(e) && (e = tu(e)),
    e = we(e),
    t && !e.dynamicChildren && (e.dynamicChildren = t.filter(n => n !== e)),
    e
}
function xl(e, t) {
    t && t.pendingBranch ? V(e) ? t.effects.push(...e) : t.effects.push(e) : En(e)
}
function Kt(e, t) {
    e.activeBranch = t;
    const {vnode: n, parentComponent: s} = e;
    let r = t.el;
    for (; !r && t.component; )
        t = t.component.subTree,
        r = t.el;
    n.el = r,
    s && s.subTree === n && (s.vnode.el = r,
    Ls(s, r))
}
function uu(e) {
    const t = e.props && e.props.suspensible;
    return t != null && t !== !1
}
const he = Symbol.for("v-fgt")
  , pt = Symbol.for("v-txt")
  , fe = Symbol.for("v-cmt")
  , Nt = Symbol.for("v-stc")
  , hn = [];
let Te = null;
function xn(e=!1) {
    hn.push(Te = e ? null : [])
}
function Al() {
    hn.pop(),
    Te = hn[hn.length - 1] || null
}
let Rt = 1;
function An(e, t=!1) {
    Rt += e,
    e < 0 && Te && t && (Te.hasOnce = !0)
}
function wl(e) {
    return e.dynamicChildren = Rt > 0 ? Te || Et : null,
    Al(),
    Rt > 0 && Te && Te.push(e),
    e
}
function hu(e, t, n, s, r, i) {
    return wl(zr(e, t, n, s, r, i, !0))
}
function ls(e, t, n, s, r) {
    return wl(ce(e, t, n, s, r, !0))
}
function it(e) {
    return e ? e.__v_isVNode === !0 : !1
}
function Ve(e, t) {
    return e.type === t.type && e.key === t.key
}
function du(e) {}
const Ol = ({key: e}) => e ?? null
  , Xn = ({ref: e, ref_key: t, ref_for: n}) => (typeof e == "number" && (e = "" + e),
e != null ? te(e) || le(e) || G(e) ? {
    i: me,
    r: e,
    k: t,
    f: !!n
} : e : null);
function zr(e, t=null, n=null, s=0, r=null, i=e === he ? 0 : 1, o=!1, l=!1) {
    const c = {
        __v_isVNode: !0,
        __v_skip: !0,
        type: e,
        props: t,
        key: t && Ol(t),
        ref: t && Xn(t),
        scopeId: As,
        slotScopeIds: null,
        children: n,
        component: null,
        suspense: null,
        ssContent: null,
        ssFallback: null,
        dirs: null,
        transition: null,
        el: null,
        anchor: null,
        target: null,
        targetStart: null,
        targetAnchor: null,
        staticCount: 0,
        shapeFlag: i,
        patchFlag: s,
        dynamicProps: r,
        dynamicChildren: null,
        appContext: null,
        ctx: me
    };
    return l ? (Qr(c, n),
    i & 128 && e.normalize(c)) : n && (c.shapeFlag |= te(n) ? 8 : 16),
    Rt > 0 && !o && Te && (c.patchFlag > 0 || i & 6) && c.patchFlag !== 32 && Te.push(c),
    c
}
const ce = pu;
function pu(e, t=null, n=null, s=0, r=null, i=!1) {
    if ((!e || e === el) && (e = fe),
    it(e)) {
        const l = qe(e, t, !0);
        return n && Qr(l, n),
        Rt > 0 && !i && Te && (l.shapeFlag & 6 ? Te[Te.indexOf(e)] = l : Te.push(l)),
        l.patchFlag = -2,
        l
    }
    if (Cu(e) && (e = e.__vccOpts),
    t) {
        t = Nl(t);
        let {class: l, style: c} = t;
        l && !te(l) && (t.class = Zt(l)),
        ne(c) && (Cs(c) && !V(c) && (c = re({}, c)),
        t.style = zt(c))
    }
    const o = te(e) ? 1 : os(e) ? 128 : Vo(e) ? 64 : ne(e) ? 4 : G(e) ? 2 : 0;
    return zr(e, t, n, s, r, o, i, !0)
}
function Nl(e) {
    return e ? Cs(e) || ll(e) ? re({}, e) : e : null
}
function qe(e, t, n=!1, s=!1) {
    const {props: r, ref: i, patchFlag: o, children: l, transition: c} = e
      , u = t ? Rl(r || {}, t) : r
      , f = {
        __v_isVNode: !0,
        __v_skip: !0,
        type: e.type,
        props: u,
        key: u && Ol(u),
        ref: t && t.ref ? n && i ? V(i) ? i.concat(Xn(t)) : [i, Xn(t)] : Xn(t) : i,
        scopeId: e.scopeId,
        slotScopeIds: e.slotScopeIds,
        children: l,
        target: e.target,
        targetStart: e.targetStart,
        targetAnchor: e.targetAnchor,
        staticCount: e.staticCount,
        shapeFlag: e.shapeFlag,
        patchFlag: t && e.type !== he ? o === -1 ? 16 : o | 16 : o,
        dynamicProps: e.dynamicProps,
        dynamicChildren: e.dynamicChildren,
        appContext: e.appContext,
        dirs: e.dirs,
        transition: c,
        component: e.component,
        suspense: e.suspense,
        ssContent: e.ssContent && qe(e.ssContent),
        ssFallback: e.ssFallback && qe(e.ssFallback),
        placeholder: e.placeholder,
        el: e.el,
        anchor: e.anchor,
        ctx: e.ctx,
        ce: e.ce
    };
    return c && s && rt(f, c.clone(f)),
    f
}
function Zr(e=" ", t=0) {
    return ce(pt, null, e, t)
}
function gu(e, t) {
    const n = ce(Nt, null, e);
    return n.staticCount = t,
    n
}
function mu(e="", t=!1) {
    return t ? (xn(),
    ls(fe, null, e)) : ce(fe, null, e)
}
function we(e) {
    return e == null || typeof e == "boolean" ? ce(fe) : V(e) ? ce(he, null, e.slice()) : it(e) ? ht(e) : ce(pt, null, String(e))
}
function ht(e) {
    return e.el === null && e.patchFlag !== -1 || e.memo ? e : qe(e)
}
function Qr(e, t) {
    let n = 0;
    const {shapeFlag: s} = e;
    if (t == null)
        t = null;
    else if (V(t))
        n = 16;
    else if (typeof t == "object")
        if (s & 65) {
            const r = t.default;
            r && (r._c && (r._d = !1),
            Qr(e, r()),
            r._c && (r._d = !0));
            return
        } else {
            n = 32;
            const r = t._;
            !r && !ll(t) ? t._ctx = me : r === 3 && me && (me.slots._ === 1 ? t._ = 1 : (t._ = 2,
            e.patchFlag |= 1024))
        }
    else
        G(t) ? (t = {
            default: t,
            _ctx: me
        },
        n = 32) : (t = String(t),
        s & 64 ? (n = 16,
        t = [Zr(t)]) : n = 8);
    e.children = t,
    e.shapeFlag |= n
}
function Rl(...e) {
    const t = {};
    for (let n = 0; n < e.length; n++) {
        const s = e[n];
        for (const r in s)
            if (r === "class")
                t.class !== s.class && (t.class = Zt([t.class, s.class]));
            else if (r === "style")
                t.style = zt([t.style, s.style]);
            else if (Jt(r)) {
                const i = t[r]
                  , o = s[r];
                o && i !== o && !(V(i) && i.includes(o)) && (t[r] = i ? [].concat(i, o) : o)
            } else
                r !== "" && (t[r] = s[r])
    }
    return t
}
function Ae(e, t, n, s=null) {
    De(e, t, 7, [n, s])
}
const _u = sl();
let yu = 0;
function Pl(e, t, n) {
    const s = e.type
      , r = (t ? t.appContext : e.appContext) || _u
      , i = {
        uid: yu++,
        vnode: e,
        type: s,
        parent: t,
        appContext: r,
        root: null,
        next: null,
        subTree: null,
        effect: null,
        update: null,
        job: null,
        scope: new Or(!0),
        render: null,
        proxy: null,
        exposed: null,
        exposeProxy: null,
        withProxy: null,
        provides: t ? t.provides : Object.create(r.provides),
        ids: t ? t.ids : ["", 0, 0],
        accessCache: null,
        renderCache: [],
        components: null,
        directives: null,
        propsOptions: fl(s, r),
        emitsOptions: Cl(s, r),
        emit: null,
        emitted: null,
        propsDefaults: X,
        inheritAttrs: s.inheritAttrs,
        ctx: X,
        data: X,
        props: X,
        attrs: X,
        slots: X,
        refs: X,
        setupState: X,
        setupContext: null,
        suspense: n,
        suspenseId: n ? n.pendingId : 0,
        asyncDep: null,
        asyncResolved: !1,
        isMounted: !1,
        isUnmounted: !1,
        isDeactivated: !1,
        bc: null,
        c: null,
        bm: null,
        m: null,
        bu: null,
        u: null,
        um: null,
        bum: null,
        da: null,
        a: null,
        rtg: null,
        rtc: null,
        ec: null,
        sp: null
    };
    return i.ctx = {
        _: i
    },
    i.root = t ? t.root : i,
    i.emit = Qa.bind(null, i),
    e.ce && e.ce(i),
    i
}
let ge = null;
const Ne = () => ge || me;
let cs, ur;
{
    const e = On()
      , t = (n, s) => {
        let r;
        return (r = e[n]) || (r = e[n] = []),
        r.push(s),
        i => {
            r.length > 1 ? r.forEach(o => o(i)) : r[0](i)
        }
    }
    ;
    cs = t("__VUE_INSTANCE_SETTERS__", n => ge = n),
    ur = t("__VUE_SSR_SETTERS__", n => Gt = n)
}
const Pt = e => {
    const t = ge;
    return cs(e),
    e.scope.on(),
    () => {
        e.scope.off(),
        cs(t)
    }
}
  , hr = () => {
    ge && ge.scope.off(),
    cs(null)
}
;
function Ml(e) {
    return e.vnode.shapeFlag & 4
}
let Gt = !1;
function Ll(e, t=!1, n=!1) {
    t && ur(t);
    const {props: s, children: r} = e.vnode
      , i = Ml(e);
    ja(e, s, i, t),
    Ga(e, r, n || t);
    const o = i ? bu(e, t) : void 0;
    return t && ur(!1),
    o
}
function bu(e, t) {
    const n = e.type;
    e.accessCache = Object.create(null),
    e.proxy = new Proxy(e.ctx,or);
    const {setup: s} = n;
    if (s) {
        tt();
        const r = e.setupContext = s.length > 1 ? Il(e) : null
          , i = Pt(e)
          , o = Qt(s, e, 0, [e.props, r])
          , l = ms(o);
        if (nt(),
        i(),
        (l || e.sp) && !dt(e) && Br(e),
        l) {
            if (o.then(hr, hr),
            t)
                return o.then(c => {
                    dr(e, c, t)
                }
                ).catch(c => {
                    Lt(c, e, 0)
                }
                );
            e.asyncDep = o
        } else
            dr(e, o, t)
    } else
        Fl(e, t)
}
function dr(e, t, n) {
    G(t) ? e.type.__ssrInlineRender ? e.ssrRender = t : e.render = t : ne(t) && (e.setupState = Ir(t)),
    Fl(e, n)
}
let fs, pr;
function Eu(e) {
    fs = e,
    pr = t => {
        t.render._rc && (t.withProxy = new Proxy(t.ctx,va))
    }
}
const vu = () => !fs;
function Fl(e, t, n) {
    const s = e.type;
    if (!e.render) {
        if (!t && fs && !s.render) {
            const r = s.template || Gr(e).template;
            if (r) {
                const {isCustomElement: i, compilerOptions: o} = e.appContext.config
                  , {delimiters: l, compilerOptions: c} = s
                  , u = re(re({
                    isCustomElement: i,
                    delimiters: l
                }, o), c);
                s.render = fs(r, u)
            }
        }
        e.render = s.render || Me,
        pr && pr(e)
    }
    {
        const r = Pt(e);
        tt();
        try {
            Ia(e)
        } finally {
            nt(),
            r()
        }
    }
}
const Tu = {
    get(e, t) {
        return Ee(e, "get", ""),
        e[t]
    }
};
function Il(e) {
    const t = n => {
        e.exposed = n || {}
    }
    ;
    return {
        attrs: new Proxy(e.attrs,Tu),
        slots: e.slots,
        emit: e.emit,
        expose: t
    }
}
function In(e) {
    return e.exposed ? e.exposeProxy || (e.exposeProxy = new Proxy(Ir(Ss(e.exposed)),{
        get(t, n) {
            if (n in t)
                return t[n];
            if (n in un)
                return un[n](e)
        },
        has(t, n) {
            return n in t || n in un
        }
    })) : e.proxy
}
function gr(e, t=!0) {
    return G(e) ? e.displayName || e.name : e.name || t && e.__name
}
function Cu(e) {
    return G(e) && "__vccOpts"in e
}
const Fs = (e, t) => Rf(e, t, Gt);
function kl(e, t, n) {
    const s = (i, o, l) => {
        An(-1);
        try {
            return ce(i, o, l)
        } finally {
            An(1)
        }
    }
      , r = arguments.length;
    return r === 2 ? ne(t) && !V(t) ? it(t) ? s(e, null, [t]) : s(e, t) : s(e, null, t) : (r > 3 ? n = Array.prototype.slice.call(arguments, 2) : r === 3 && it(n) && (n = [n]),
    s(e, t, n))
}
function Su() {}
function xu(e, t, n, s) {
    const r = n[s];
    if (r && Dl(r, e))
        return r;
    const i = t();
    return i.memo = e.slice(),
    i.cacheIndex = s,
    n[s] = i
}
function Dl(e, t) {
    const n = e.memo;
    if (n.length != t.length)
        return !1;
    for (let s = 0; s < n.length; s++)
        if (be(n[s], t[s]))
            return !1;
    return Rt > 0 && Te && Te.push(e),
    !0
}
const Hl = "3.5.21"
  , Au = Me
  , wu = Vf
  , Ou = Vt
  , Nu = Do
  , Ru = {
    createComponentInstance: Pl,
    setupComponent: Ll,
    renderComponentRoot: Jn,
    setCurrentRenderingInstance: Tn,
    isVNode: it,
    normalizeVNode: we,
    getComponentPublicInstance: In,
    ensureValidVNode: Wr,
    pushWarningContext: If,
    popWarningContext: kf
}
  , Pu = Ru
  , Mu = null
  , Lu = null
  , Fu = null;
/**
* @vue/runtime-dom v3.5.21
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
let mr;
const Oi = typeof window < "u" && window.trustedTypes;
if (Oi)
    try {
        mr = Oi.createPolicy("vue", {
            createHTML: e => e
        })
    } catch {}
const Vl = mr ? e => mr.createHTML(e) : e => e
  , Iu = "http://www.w3.org/2000/svg"
  , ku = "http://www.w3.org/1998/Math/MathML"
  , Je = typeof document < "u" ? document : null
  , Ni = Je && Je.createElement("template")
  , Du = {
    insert: (e, t, n) => {
        t.insertBefore(e, n || null)
    }
    ,
    remove: e => {
        const t = e.parentNode;
        t && t.removeChild(e)
    }
    ,
    createElement: (e, t, n, s) => {
        const r = t === "svg" ? Je.createElementNS(Iu, e) : t === "mathml" ? Je.createElementNS(ku, e) : n ? Je.createElement(e, {
            is: n
        }) : Je.createElement(e);
        return e === "select" && s && s.multiple != null && r.setAttribute("multiple", s.multiple),
        r
    }
    ,
    createText: e => Je.createTextNode(e),
    createComment: e => Je.createComment(e),
    setText: (e, t) => {
        e.nodeValue = t
    }
    ,
    setElementText: (e, t) => {
        e.textContent = t
    }
    ,
    parentNode: e => e.parentNode,
    nextSibling: e => e.nextSibling,
    querySelector: e => Je.querySelector(e),
    setScopeId(e, t) {
        e.setAttribute(t, "")
    },
    insertStaticContent(e, t, n, s, r, i) {
        const o = n ? n.previousSibling : t.lastChild;
        if (r && (r === i || r.nextSibling))
            for (; t.insertBefore(r.cloneNode(!0), n),
            !(r === i || !(r = r.nextSibling)); )
                ;
        else {
            Ni.innerHTML = Vl(s === "svg" ? `<svg>${e}</svg>` : s === "mathml" ? `<math>${e}</math>` : e);
            const l = Ni.content;
            if (s === "svg" || s === "mathml") {
                const c = l.firstChild;
                for (; c.firstChild; )
                    l.appendChild(c.firstChild);
                l.removeChild(c)
            }
            t.insertBefore(l, n)
        }
        return [o ? o.nextSibling : t.firstChild, n ? n.previousSibling : t.lastChild]
    }
}
  , lt = "transition"
  , sn = "animation"
  , qt = Symbol("_vtc")
  , Ul = {
    name: String,
    type: String,
    css: {
        type: Boolean,
        default: !0
    },
    duration: [String, Number, Object],
    enterFromClass: String,
    enterActiveClass: String,
    enterToClass: String,
    appearFromClass: String,
    appearActiveClass: String,
    appearToClass: String,
    leaveFromClass: String,
    leaveActiveClass: String,
    leaveToClass: String
}
  , Bl = re({}, Vr, Ul)
  , Hu = e => (e.displayName = "Transition",
e.props = Bl,
e)
  , Vu = Hu( (e, {slots: t}) => kl(Ko, jl(e), t))
  , bt = (e, t=[]) => {
    V(e) ? e.forEach(n => n(...t)) : e && e(...t)
}
  , Ri = e => e ? V(e) ? e.some(t => t.length > 1) : e.length > 1 : !1;
function jl(e) {
    const t = {};
    for (const w in e)
        w in Ul || (t[w] = e[w]);
    if (e.css === !1)
        return t;
    const {name: n="v", type: s, duration: r, enterFromClass: i=`${n}-enter-from`, enterActiveClass: o=`${n}-enter-active`, enterToClass: l=`${n}-enter-to`, appearFromClass: c=i, appearActiveClass: u=o, appearToClass: f=l, leaveFromClass: h=`${n}-leave-from`, leaveActiveClass: m=`${n}-leave-active`, leaveToClass: y=`${n}-leave-to`} = e
      , T = Uu(r)
      , v = T && T[0]
      , B = T && T[1]
      , {onBeforeEnter: D, onEnter: A, onEnterCancelled: p, onLeave: g, onLeaveCancelled: _, onBeforeAppear: R=D, onAppear: F=A, onAppearCancelled: P=p} = t
      , E = (w, K, z, se) => {
        w._enterCancelled = se,
        ct(w, K ? f : l),
        ct(w, K ? u : o),
        z && z()
    }
      , C = (w, K) => {
        w._isLeaving = !1,
        ct(w, h),
        ct(w, y),
        ct(w, m),
        K && K()
    }
      , U = w => (K, z) => {
        const se = w ? F : A
          , H = () => E(K, w, z);
        bt(se, [K, H]),
        Pi( () => {
            ct(K, w ? c : i),
            Ke(K, w ? f : l),
            Ri(se) || Mi(K, s, v, H)
        }
        )
    }
    ;
    return re(t, {
        onBeforeEnter(w) {
            bt(D, [w]),
            Ke(w, i),
            Ke(w, o)
        },
        onBeforeAppear(w) {
            bt(R, [w]),
            Ke(w, c),
            Ke(w, u)
        },
        onEnter: U(!1),
        onAppear: U(!0),
        onLeave(w, K) {
            w._isLeaving = !0;
            const z = () => C(w, K);
            Ke(w, h),
            w._enterCancelled ? (Ke(w, m),
            _r()) : (_r(),
            Ke(w, m)),
            Pi( () => {
                w._isLeaving && (ct(w, h),
                Ke(w, y),
                Ri(g) || Mi(w, s, B, z))
            }
            ),
            bt(g, [w, z])
        },
        onEnterCancelled(w) {
            E(w, !1, void 0, !0),
            bt(p, [w])
        },
        onAppearCancelled(w) {
            E(w, !0, void 0, !0),
            bt(P, [w])
        },
        onLeaveCancelled(w) {
            C(w),
            bt(_, [w])
        }
    })
}
function Uu(e) {
    if (e == null)
        return null;
    if (ne(e))
        return [Xs(e.enter), Xs(e.leave)];
    {
        const t = Xs(e);
        return [t, t]
    }
}
function Xs(e) {
    return mn(e)
}
function Ke(e, t) {
    t.split(/\s+/).forEach(n => n && e.classList.add(n)),
    (e[qt] || (e[qt] = new Set)).add(t)
}
function ct(e, t) {
    t.split(/\s+/).forEach(s => s && e.classList.remove(s));
    const n = e[qt];
    n && (n.delete(t),
    n.size || (e[qt] = void 0))
}
function Pi(e) {
    requestAnimationFrame( () => {
        requestAnimationFrame(e)
    }
    )
}
let Bu = 0;
function Mi(e, t, n, s) {
    const r = e._endId = ++Bu
      , i = () => {
        r === e._endId && s()
    }
    ;
    if (n != null)
        return setTimeout(i, n);
    const {type: o, timeout: l, propCount: c} = $l(e, t);
    if (!o)
        return s();
    const u = o + "end";
    let f = 0;
    const h = () => {
        e.removeEventListener(u, m),
        i()
    }
      , m = y => {
        y.target === e && ++f >= c && h()
    }
    ;
    setTimeout( () => {
        f < c && h()
    }
    , l + 1),
    e.addEventListener(u, m)
}
function $l(e, t) {
    const n = window.getComputedStyle(e)
      , s = T => (n[T] || "").split(", ")
      , r = s(`${lt}Delay`)
      , i = s(`${lt}Duration`)
      , o = Li(r, i)
      , l = s(`${sn}Delay`)
      , c = s(`${sn}Duration`)
      , u = Li(l, c);
    let f = null
      , h = 0
      , m = 0;
    t === lt ? o > 0 && (f = lt,
    h = o,
    m = i.length) : t === sn ? u > 0 && (f = sn,
    h = u,
    m = c.length) : (h = Math.max(o, u),
    f = h > 0 ? o > u ? lt : sn : null,
    m = f ? f === lt ? i.length : c.length : 0);
    const y = f === lt && /\b(?:transform|all)(?:,|$)/.test(s(`${lt}Property`).toString());
    return {
        type: f,
        timeout: h,
        propCount: m,
        hasTransform: y
    }
}
function Li(e, t) {
    for (; e.length < t.length; )
        e = e.concat(e);
    return Math.max(...t.map( (n, s) => Fi(n) + Fi(e[s])))
}
function Fi(e) {
    return e === "auto" ? 0 : Number(e.slice(0, -1).replace(",", ".")) * 1e3
}
function _r() {
    return document.body.offsetHeight
}
function ju(e, t, n) {
    const s = e[qt];
    s && (t = (t ? [t, ...s] : [...s]).join(" ")),
    t == null ? e.removeAttribute("class") : n ? e.setAttribute("class", t) : e.className = t
}
const as = Symbol("_vod")
  , Kl = Symbol("_vsh")
  , Wl = {
    name: "show",
    beforeMount(e, {value: t}, {transition: n}) {
        e[as] = e.style.display === "none" ? "" : e.style.display,
        n && t ? n.beforeEnter(e) : rn(e, t)
    },
    mounted(e, {value: t}, {transition: n}) {
        n && t && n.enter(e)
    },
    updated(e, {value: t, oldValue: n}, {transition: s}) {
        !t != !n && (s ? t ? (s.beforeEnter(e),
        rn(e, !0),
        s.enter(e)) : s.leave(e, () => {
            rn(e, !1)
        }
        ) : rn(e, t))
    },
    beforeUnmount(e, {value: t}) {
        rn(e, t)
    }
};
function rn(e, t) {
    e.style.display = t ? e[as] : "none",
    e[Kl] = !t
}
function $u() {
    Wl.getSSRProps = ({value: e}) => {
        if (!e)
            return {
                style: {
                    display: "none"
                }
            }
    }
}
const Gl = Symbol("");
function Ku(e) {
    const t = Ne();
    if (!t)
        return;
    const n = t.ut = (r=e(t.proxy)) => {
        Array.from(document.querySelectorAll(`[data-v-owner="${t.uid}"]`)).forEach(i => us(i, r))
    }
      , s = () => {
        const r = e(t.proxy);
        t.ce ? us(t.ce, r) : yr(t.subTree, r),
        n(r)
    }
    ;
    jr( () => {
        En(s)
    }
    ),
    Ln( () => {
        Ot(s, Me, {
            flush: "post"
        });
        const r = new MutationObserver(s);
        r.observe(t.subTree.el.parentNode, {
            childList: !0
        }),
        Ps( () => r.disconnect())
    }
    )
}
function yr(e, t) {
    if (e.shapeFlag & 128) {
        const n = e.suspense;
        e = n.activeBranch,
        n.pendingBranch && !n.isHydrating && n.effects.push( () => {
            yr(n.activeBranch, t)
        }
        )
    }
    for (; e.component; )
        e = e.component.subTree;
    if (e.shapeFlag & 1 && e.el)
        us(e.el, t);
    else if (e.type === he)
        e.children.forEach(n => yr(n, t));
    else if (e.type === Nt) {
        let {el: n, anchor: s} = e;
        for (; n && (us(n, t),
        n !== s); )
            n = n.nextSibling
    }
}
function us(e, t) {
    if (e.nodeType === 1) {
        const n = e.style;
        let s = "";
        for (const r in t) {
            const i = lo(t[r]);
            n.setProperty(`--${r}`, i),
            s += `--${r}: ${i};`
        }
        n[Gl] = s
    }
}
const Wu = /(?:^|;)\s*display\s*:/;
function Gu(e, t, n) {
    const s = e.style
      , r = te(n);
    let i = !1;
    if (n && !r) {
        if (t)
            if (te(t))
                for (const o of t.split(";")) {
                    const l = o.slice(0, o.indexOf(":")).trim();
                    n[l] == null && zn(s, l, "")
                }
            else
                for (const o in t)
                    n[o] == null && zn(s, o, "");
        for (const o in n)
            o === "display" && (i = !0),
            zn(s, o, n[o])
    } else if (r) {
        if (t !== n) {
            const o = s[Gl];
            o && (n += ";" + o),
            s.cssText = n,
            i = Wu.test(n)
        }
    } else
        t && e.removeAttribute("style");
    as in e && (e[as] = i ? s.display : "",
    e[Kl] && (s.display = "none"))
}
const Ii = /\s*!important$/;
function zn(e, t, n) {
    if (V(n))
        n.forEach(s => zn(e, t, s));
    else if (n == null && (n = ""),
    t.startsWith("--"))
        e.setProperty(t, n);
    else {
        const s = qu(e, t);
        Ii.test(n) ? e.setProperty(ve(s), n.replace(Ii, ""), "important") : e[s] = n
    }
}
const ki = ["Webkit", "Moz", "ms"]
  , zs = {};
function qu(e, t) {
    const n = zs[t];
    if (n)
        return n;
    let s = de(t);
    if (s !== "filter" && s in e)
        return zs[t] = s;
    s = Xt(s);
    for (let r = 0; r < ki.length; r++) {
        const i = ki[r] + s;
        if (i in e)
            return zs[t] = i
    }
    return t
}
const Di = "http://www.w3.org/1999/xlink";
function Hi(e, t, n, s, r, i=so(t)) {
    s && t.startsWith("xlink:") ? n == null ? e.removeAttributeNS(Di, t.slice(6, t.length)) : e.setAttributeNS(Di, t, n) : n == null || i && !Ar(n) ? e.removeAttribute(t) : e.setAttribute(t, i ? "" : ke(n) ? String(n) : n)
}
function Vi(e, t, n, s, r) {
    if (t === "innerHTML" || t === "textContent") {
        n != null && (e[t] = t === "innerHTML" ? Vl(n) : n);
        return
    }
    const i = e.tagName;
    if (t === "value" && i !== "PROGRESS" && !i.includes("-")) {
        const l = i === "OPTION" ? e.getAttribute("value") || "" : e.value
          , c = n == null ? e.type === "checkbox" ? "on" : "" : String(n);
        (l !== c || !("_value"in e)) && (e.value = c),
        n == null && e.removeAttribute(t),
        e._value = n;
        return
    }
    let o = !1;
    if (n === "" || n == null) {
        const l = typeof e[t];
        l === "boolean" ? n = Ar(n) : n == null && l === "string" ? (n = "",
        o = !0) : l === "number" && (n = 0,
        o = !0)
    }
    try {
        e[t] = n
    } catch {}
    o && e.removeAttribute(r || t)
}
function Qe(e, t, n, s) {
    e.addEventListener(t, n, s)
}
function Yu(e, t, n, s) {
    e.removeEventListener(t, n, s)
}
const Ui = Symbol("_vei");
function Ju(e, t, n, s, r=null) {
    const i = e[Ui] || (e[Ui] = {})
      , o = i[t];
    if (s && o)
        o.value = s;
    else {
        const [l,c] = Xu(t);
        if (s) {
            const u = i[t] = Qu(s, r);
            Qe(e, l, u, c)
        } else
            o && (Yu(e, l, o, c),
            i[t] = void 0)
    }
}
const Bi = /(?:Once|Passive|Capture)$/;
function Xu(e) {
    let t;
    if (Bi.test(e)) {
        t = {};
        let s;
        for (; s = e.match(Bi); )
            e = e.slice(0, e.length - s[0].length),
            t[s[0].toLowerCase()] = !0
    }
    return [e[2] === ":" ? e.slice(3) : ve(e.slice(2)), t]
}
let Zs = 0;
const zu = Promise.resolve()
  , Zu = () => Zs || (zu.then( () => Zs = 0),
Zs = Date.now());
function Qu(e, t) {
    const n = s => {
        if (!s._vts)
            s._vts = Date.now();
        else if (s._vts <= n.attached)
            return;
        De(eh(s, n.value), t, 5, [s])
    }
    ;
    return n.value = e,
    n.attached = Zu(),
    n
}
function eh(e, t) {
    if (V(t)) {
        const n = e.stopImmediatePropagation;
        return e.stopImmediatePropagation = () => {
            n.call(e),
            e._stopped = !0
        }
        ,
        t.map(s => r => !r._stopped && s && s(r))
    } else
        return t
}
const ji = e => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && e.charCodeAt(2) > 96 && e.charCodeAt(2) < 123
  , th = (e, t, n, s, r, i) => {
    const o = r === "svg";
    t === "class" ? ju(e, s, o) : t === "style" ? Gu(e, n, s) : Jt(t) ? ps(t) || Ju(e, t, n, s, i) : (t[0] === "." ? (t = t.slice(1),
    !0) : t[0] === "^" ? (t = t.slice(1),
    !1) : nh(e, t, s, o)) ? (Vi(e, t, s),
    !e.tagName.includes("-") && (t === "value" || t === "checked" || t === "selected") && Hi(e, t, s, o, i, t !== "value")) : e._isVueCE && (/[A-Z]/.test(t) || !te(s)) ? Vi(e, de(t), s, i, t) : (t === "true-value" ? e._trueValue = s : t === "false-value" && (e._falseValue = s),
    Hi(e, t, s, o))
}
;
function nh(e, t, n, s) {
    if (s)
        return !!(t === "innerHTML" || t === "textContent" || t in e && ji(t) && G(n));
    if (t === "spellcheck" || t === "draggable" || t === "translate" || t === "autocorrect" || t === "form" || t === "list" && e.tagName === "INPUT" || t === "type" && e.tagName === "TEXTAREA")
        return !1;
    if (t === "width" || t === "height") {
        const r = e.tagName;
        if (r === "IMG" || r === "VIDEO" || r === "CANVAS" || r === "SOURCE")
            return !1
    }
    return ji(t) && te(n) ? !1 : t in e
}
const $i = {};
function ql(e, t, n) {
    let s = Ur(e, t);
    wn(s) && (s = re({}, s, t));
    class r extends Is {
        constructor(o) {
            super(s, o, n)
        }
    }
    return r.def = s,
    r
}
const sh = ( (e, t) => ql(e, t, ic))
  , rh = typeof HTMLElement < "u" ? HTMLElement : class {
}
;
class Is extends rh {
    constructor(t, n={}, s=br) {
        super(),
        this._def = t,
        this._props = n,
        this._createApp = s,
        this._isVueCE = !0,
        this._instance = null,
        this._app = null,
        this._nonce = this._def.nonce,
        this._connected = !1,
        this._resolved = !1,
        this._numberProps = null,
        this._styleChildren = new WeakSet,
        this._ob = null,
        this.shadowRoot && s !== br ? this._root = this.shadowRoot : t.shadowRoot !== !1 ? (this.attachShadow({
            mode: "open"
        }),
        this._root = this.shadowRoot) : this._root = this
    }
    connectedCallback() {
        if (!this.isConnected)
            return;
        !this.shadowRoot && !this._resolved && this._parseSlots(),
        this._connected = !0;
        let t = this;
        for (; t = t && (t.parentNode || t.host); )
            if (t instanceof Is) {
                this._parent = t;
                break
            }
        this._instance || (this._resolved ? this._mount(this._def) : t && t._pendingResolve ? this._pendingResolve = t._pendingResolve.then( () => {
            this._pendingResolve = void 0,
            this._resolveDef()
        }
        ) : this._resolveDef())
    }
    _setParent(t=this._parent) {
        t && (this._instance.parent = t._instance,
        this._inheritParentContext(t))
    }
    _inheritParentContext(t=this._parent) {
        t && this._app && Object.setPrototypeOf(this._app._context.provides, t._instance.provides)
    }
    disconnectedCallback() {
        this._connected = !1,
        Pn( () => {
            this._connected || (this._ob && (this._ob.disconnect(),
            this._ob = null),
            this._app && this._app.unmount(),
            this._instance && (this._instance.ce = void 0),
            this._app = this._instance = null)
        }
        )
    }
    _resolveDef() {
        if (this._pendingResolve)
            return;
        for (let s = 0; s < this.attributes.length; s++)
            this._setAttr(this.attributes[s].name);
        this._ob = new MutationObserver(s => {
            for (const r of s)
                this._setAttr(r.attributeName)
        }
        ),
        this._ob.observe(this, {
            attributes: !0
        });
        const t = (s, r=!1) => {
            this._resolved = !0,
            this._pendingResolve = void 0;
            const {props: i, styles: o} = s;
            let l;
            if (i && !V(i))
                for (const c in i) {
                    const u = i[c];
                    (u === Number || u && u.type === Number) && (c in this._props && (this._props[c] = mn(this._props[c])),
                    (l || (l = Object.create(null)))[de(c)] = !0)
                }
            this._numberProps = l,
            this._resolveProps(s),
            this.shadowRoot && this._applyStyles(o),
            this._mount(s)
        }
          , n = this._def.__asyncLoader;
        n ? this._pendingResolve = n().then(s => {
            s.configureApp = this._def.configureApp,
            t(this._def = s, !0)
        }
        ) : t(this._def)
    }
    _mount(t) {
        this._app = this._createApp(t),
        this._inheritParentContext(),
        t.configureApp && t.configureApp(this._app),
        this._app._ceVNode = this._createVNode(),
        this._app.mount(this._root);
        const n = this._instance && this._instance.exposed;
        if (n)
            for (const s in n)
                Q(this, s) || Object.defineProperty(this, s, {
                    get: () => xs(n[s])
                })
    }
    _resolveProps(t) {
        const {props: n} = t
          , s = V(n) ? n : Object.keys(n || {});
        for (const r of Object.keys(this))
            r[0] !== "_" && s.includes(r) && this._setProp(r, this[r]);
        for (const r of s.map(de))
            Object.defineProperty(this, r, {
                get() {
                    return this._getProp(r)
                },
                set(i) {
                    this._setProp(r, i, !0, !0)
                }
            })
    }
    _setAttr(t) {
        if (t.startsWith("data-v-"))
            return;
        const n = this.hasAttribute(t);
        let s = n ? this.getAttribute(t) : $i;
        const r = de(t);
        n && this._numberProps && this._numberProps[r] && (s = mn(s)),
        this._setProp(r, s, !1, !0)
    }
    _getProp(t) {
        return this._props[t]
    }
    _setProp(t, n, s=!0, r=!1) {
        if (n !== this._props[t] && (n === $i ? delete this._props[t] : (this._props[t] = n,
        t === "key" && this._app && (this._app._ceVNode.key = n)),
        r && this._instance && this._update(),
        s)) {
            const i = this._ob;
            i && i.disconnect(),
            n === !0 ? this.setAttribute(ve(t), "") : typeof n == "string" || typeof n == "number" ? this.setAttribute(ve(t), n + "") : n || this.removeAttribute(ve(t)),
            i && i.observe(this, {
                attributes: !0
            })
        }
    }
    _update() {
        const t = this._createVNode();
        this._app && (t.appContext = this._app._context),
        rc(t, this._root)
    }
    _createVNode() {
        const t = {};
        this.shadowRoot || (t.onVnodeMounted = t.onVnodeUpdated = this._renderSlots.bind(this));
        const n = ce(this._def, re(t, this._props));
        return this._instance || (n.ce = s => {
            this._instance = s,
            s.ce = this,
            s.isCE = !0;
            const r = (i, o) => {
                this.dispatchEvent(new CustomEvent(i,wn(o[0]) ? re({
                    detail: o
                }, o[0]) : {
                    detail: o
                }))
            }
            ;
            s.emit = (i, ...o) => {
                r(i, o),
                ve(i) !== i && r(ve(i), o)
            }
            ,
            this._setParent()
        }
        ),
        n
    }
    _applyStyles(t, n) {
        if (!t)
            return;
        if (n) {
            if (n === this._def || this._styleChildren.has(n))
                return;
            this._styleChildren.add(n)
        }
        const s = this._nonce;
        for (let r = t.length - 1; r >= 0; r--) {
            const i = document.createElement("style");
            s && i.setAttribute("nonce", s),
            i.textContent = t[r],
            this.shadowRoot.prepend(i)
        }
    }
    _parseSlots() {
        const t = this._slots = {};
        let n;
        for (; n = this.firstChild; ) {
            const s = n.nodeType === 1 && n.getAttribute("slot") || "default";
            (t[s] || (t[s] = [])).push(n),
            this.removeChild(n)
        }
    }
    _renderSlots() {
        const t = (this._teleportTarget || this).querySelectorAll("slot")
          , n = this._instance.type.__scopeId;
        for (let s = 0; s < t.length; s++) {
            const r = t[s]
              , i = r.getAttribute("name") || "default"
              , o = this._slots[i]
              , l = r.parentNode;
            if (o)
                for (const c of o) {
                    if (n && c.nodeType === 1) {
                        const u = n + "-s"
                          , f = document.createTreeWalker(c, 1);
                        c.setAttribute(u, "");
                        let h;
                        for (; h = f.nextNode(); )
                            h.setAttribute(u, "")
                    }
                    l.insertBefore(c, r)
                }
            else
                for (; r.firstChild; )
                    l.insertBefore(r.firstChild, r);
            l.removeChild(r)
        }
    }
    _injectChildStyle(t) {
        this._applyStyles(t.styles, t)
    }
    _removeChildStyle(t) {}
}
function Yl(e) {
    const t = Ne()
      , n = t && t.ce;
    return n || null
}
function ih() {
    const e = Yl();
    return e && e.shadowRoot
}
function oh(e="$style") {
    {
        const t = Ne();
        if (!t)
            return X;
        const n = t.type.__cssModules;
        if (!n)
            return X;
        const s = n[e];
        return s || X
    }
}
const Jl = new WeakMap
  , Xl = new WeakMap
  , hs = Symbol("_moveCb")
  , Ki = Symbol("_enterCb")
  , lh = e => (delete e.props.mode,
e)
  , ch = lh({
    name: "TransitionGroup",
    props: re({}, Bl, {
        tag: String,
        moveClass: String
    }),
    setup(e, {slots: t}) {
        const n = Ne()
          , s = Hr();
        let r, i;
        return Ns( () => {
            if (!r.length)
                return;
            const o = e.moveClass || `${e.name || "v"}-move`;
            if (!dh(r[0].el, n.vnode.el, o)) {
                r = [];
                return
            }
            r.forEach(ah),
            r.forEach(uh);
            const l = r.filter(hh);
            _r(),
            l.forEach(c => {
                const u = c.el
                  , f = u.style;
                Ke(u, o),
                f.transform = f.webkitTransform = f.transitionDuration = "";
                const h = u[hs] = m => {
                    m && m.target !== u || (!m || m.propertyName.endsWith("transform")) && (u.removeEventListener("transitionend", h),
                    u[hs] = null,
                    ct(u, o))
                }
                ;
                u.addEventListener("transitionend", h)
            }
            ),
            r = []
        }
        ),
        () => {
            const o = J(e)
              , l = jl(o);
            let c = o.tag || he;
            if (r = [],
            i)
                for (let u = 0; u < i.length; u++) {
                    const f = i[u];
                    f.el && f.el instanceof Element && (r.push(f),
                    rt(f, Wt(f, l, s, n)),
                    Jl.set(f, f.el.getBoundingClientRect()))
                }
            i = t.default ? ws(t.default()) : [];
            for (let u = 0; u < i.length; u++) {
                const f = i[u];
                f.key != null && rt(f, Wt(f, l, s, n))
            }
            return ce(c, null, i)
        }
    }
})
  , fh = ch;
function ah(e) {
    const t = e.el;
    t[hs] && t[hs](),
    t[Ki] && t[Ki]()
}
function uh(e) {
    Xl.set(e, e.el.getBoundingClientRect())
}
function hh(e) {
    const t = Jl.get(e)
      , n = Xl.get(e)
      , s = t.left - n.left
      , r = t.top - n.top;
    if (s || r) {
        const i = e.el.style;
        return i.transform = i.webkitTransform = `translate(${s}px,${r}px)`,
        i.transitionDuration = "0s",
        e
    }
}
function dh(e, t, n) {
    const s = e.cloneNode()
      , r = e[qt];
    r && r.forEach(l => {
        l.split(/\s+/).forEach(c => c && s.classList.remove(c))
    }
    ),
    n.split(/\s+/).forEach(l => l && s.classList.add(l)),
    s.style.display = "none";
    const i = t.nodeType === 1 ? t : t.parentNode;
    i.appendChild(s);
    const {hasTransform: o} = $l(s);
    return i.removeChild(s),
    o
}
const gt = e => {
    const t = e.props["onUpdate:modelValue"] || !1;
    return V(t) ? n => Ct(t, n) : t
}
;
function ph(e) {
    e.target.composing = !0
}
function Wi(e) {
    const t = e.target;
    t.composing && (t.composing = !1,
    t.dispatchEvent(new Event("input")))
}
const Ie = Symbol("_assign")
  , ds = {
    created(e, {modifiers: {lazy: t, trim: n, number: s}}, r) {
        e[Ie] = gt(r);
        const i = s || r.props && r.props.type === "number";
        Qe(e, t ? "change" : "input", o => {
            if (o.target.composing)
                return;
            let l = e.value;
            n && (l = l.trim()),
            i && (l = gn(l)),
            e[Ie](l)
        }
        ),
        n && Qe(e, "change", () => {
            e.value = e.value.trim()
        }
        ),
        t || (Qe(e, "compositionstart", ph),
        Qe(e, "compositionend", Wi),
        Qe(e, "change", Wi))
    },
    mounted(e, {value: t}) {
        e.value = t ?? ""
    },
    beforeUpdate(e, {value: t, oldValue: n, modifiers: {lazy: s, trim: r, number: i}}, o) {
        if (e[Ie] = gt(o),
        e.composing)
            return;
        const l = (i || e.type === "number") && !/^0\d/.test(e.value) ? gn(e.value) : e.value
          , c = t ?? "";
        l !== c && (document.activeElement === e && e.type !== "range" && (s && t === n || r && e.value.trim() === c) || (e.value = c))
    }
}
  , ei = {
    deep: !0,
    created(e, t, n) {
        e[Ie] = gt(n),
        Qe(e, "change", () => {
            const s = e._modelValue
              , r = Yt(e)
              , i = e.checked
              , o = e[Ie];
            if (V(s)) {
                const l = Nn(s, r)
                  , c = l !== -1;
                if (i && !c)
                    o(s.concat(r));
                else if (!i && c) {
                    const u = [...s];
                    u.splice(l, 1),
                    o(u)
                }
            } else if (mt(s)) {
                const l = new Set(s);
                i ? l.add(r) : l.delete(r),
                o(l)
            } else
                o(Zl(e, i))
        }
        )
    },
    mounted: Gi,
    beforeUpdate(e, t, n) {
        e[Ie] = gt(n),
        Gi(e, t, n)
    }
};
function Gi(e, {value: t, oldValue: n}, s) {
    e._modelValue = t;
    let r;
    if (V(t))
        r = Nn(t, s.props.value) > -1;
    else if (mt(t))
        r = t.has(s.props.value);
    else {
        if (t === n)
            return;
        r = et(t, Zl(e, !0))
    }
    e.checked !== r && (e.checked = r)
}
const ti = {
    created(e, {value: t}, n) {
        e.checked = et(t, n.props.value),
        e[Ie] = gt(n),
        Qe(e, "change", () => {
            e[Ie](Yt(e))
        }
        )
    },
    beforeUpdate(e, {value: t, oldValue: n}, s) {
        e[Ie] = gt(s),
        t !== n && (e.checked = et(t, s.props.value))
    }
}
  , zl = {
    deep: !0,
    created(e, {value: t, modifiers: {number: n}}, s) {
        const r = mt(t);
        Qe(e, "change", () => {
            const i = Array.prototype.filter.call(e.options, o => o.selected).map(o => n ? gn(Yt(o)) : Yt(o));
            e[Ie](e.multiple ? r ? new Set(i) : i : i[0]),
            e._assigning = !0,
            Pn( () => {
                e._assigning = !1
            }
            )
        }
        ),
        e[Ie] = gt(s)
    },
    mounted(e, {value: t}) {
        qi(e, t)
    },
    beforeUpdate(e, t, n) {
        e[Ie] = gt(n)
    },
    updated(e, {value: t}) {
        e._assigning || qi(e, t)
    }
};
function qi(e, t) {
    const n = e.multiple
      , s = V(t);
    if (!(n && !s && !mt(t))) {
        for (let r = 0, i = e.options.length; r < i; r++) {
            const o = e.options[r]
              , l = Yt(o);
            if (n)
                if (s) {
                    const c = typeof l;
                    c === "string" || c === "number" ? o.selected = t.some(u => String(u) === String(l)) : o.selected = Nn(t, l) > -1
                } else
                    o.selected = t.has(l);
            else if (et(Yt(o), t)) {
                e.selectedIndex !== r && (e.selectedIndex = r);
                return
            }
        }
        !n && e.selectedIndex !== -1 && (e.selectedIndex = -1)
    }
}
function Yt(e) {
    return "_value"in e ? e._value : e.value
}
function Zl(e, t) {
    const n = t ? "_trueValue" : "_falseValue";
    return n in e ? e[n] : t
}
const Ql = {
    created(e, t, n) {
        qn(e, t, n, null, "created")
    },
    mounted(e, t, n) {
        qn(e, t, n, null, "mounted")
    },
    beforeUpdate(e, t, n, s) {
        qn(e, t, n, s, "beforeUpdate")
    },
    updated(e, t, n, s) {
        qn(e, t, n, s, "updated")
    }
};
function ec(e, t) {
    switch (e) {
    case "SELECT":
        return zl;
    case "TEXTAREA":
        return ds;
    default:
        switch (t) {
        case "checkbox":
            return ei;
        case "radio":
            return ti;
        default:
            return ds
        }
    }
}
function qn(e, t, n, s, r) {
    const o = ec(e.tagName, n.props && n.props.type)[r];
    o && o(e, t, n, s)
}
function gh() {
    ds.getSSRProps = ({value: e}) => ({
        value: e
    }),
    ti.getSSRProps = ({value: e}, t) => {
        if (t.props && et(t.props.value, e))
            return {
                checked: !0
            }
    }
    ,
    ei.getSSRProps = ({value: e}, t) => {
        if (V(e)) {
            if (t.props && Nn(e, t.props.value) > -1)
                return {
                    checked: !0
                }
        } else if (mt(e)) {
            if (t.props && e.has(t.props.value))
                return {
                    checked: !0
                }
        } else if (e)
            return {
                checked: !0
            }
    }
    ,
    Ql.getSSRProps = (e, t) => {
        if (typeof t.type != "string")
            return;
        const n = ec(t.type.toUpperCase(), t.props && t.props.type);
        if (n.getSSRProps)
            return n.getSSRProps(e, t)
    }
}
const mh = ["ctrl", "shift", "alt", "meta"]
  , _h = {
    stop: e => e.stopPropagation(),
    prevent: e => e.preventDefault(),
    self: e => e.target !== e.currentTarget,
    ctrl: e => !e.ctrlKey,
    shift: e => !e.shiftKey,
    alt: e => !e.altKey,
    meta: e => !e.metaKey,
    left: e => "button"in e && e.button !== 0,
    middle: e => "button"in e && e.button !== 1,
    right: e => "button"in e && e.button !== 2,
    exact: (e, t) => mh.some(n => e[`${n}Key`] && !t.includes(n))
}
  , yh = (e, t) => {
    const n = e._withMods || (e._withMods = {})
      , s = t.join(".");
    return n[s] || (n[s] = ( (r, ...i) => {
        for (let o = 0; o < t.length; o++) {
            const l = _h[t[o]];
            if (l && l(r, t))
                return
        }
        return e(r, ...i)
    }
    ))
}
  , bh = {
    esc: "escape",
    space: " ",
    up: "arrow-up",
    left: "arrow-left",
    right: "arrow-right",
    down: "arrow-down",
    delete: "backspace"
}
  , Eh = (e, t) => {
    const n = e._withKeys || (e._withKeys = {})
      , s = t.join(".");
    return n[s] || (n[s] = (r => {
        if (!("key"in r))
            return;
        const i = ve(r.key);
        if (t.some(o => o === i || bh[o] === i))
            return e(r)
    }
    ))
}
  , tc = re({
    patchProp: th
}, Du);
let dn, Yi = !1;
function nc() {
    return dn || (dn = dl(tc))
}
function sc() {
    return dn = Yi ? dn : pl(tc),
    Yi = !0,
    dn
}
const rc = ( (...e) => {
    nc().render(...e)
}
)
  , vh = ( (...e) => {
    sc().hydrate(...e)
}
)
  , br = ( (...e) => {
    const t = nc().createApp(...e)
      , {mount: n} = t;
    return t.mount = s => {
        const r = lc(s);
        if (!r)
            return;
        const i = t._component;
        !G(i) && !i.render && !i.template && (i.template = r.innerHTML),
        r.nodeType === 1 && (r.textContent = "");
        const o = n(r, !1, oc(r));
        return r instanceof Element && (r.removeAttribute("v-cloak"),
        r.setAttribute("data-v-app", "")),
        o
    }
    ,
    t
}
)
  , ic = ( (...e) => {
    const t = sc().createApp(...e)
      , {mount: n} = t;
    return t.mount = s => {
        const r = lc(s);
        if (r)
            return n(r, !0, oc(r))
    }
    ,
    t
}
);
function oc(e) {
    if (e instanceof SVGElement)
        return "svg";
    if (typeof MathMLElement == "function" && e instanceof MathMLElement)
        return "mathml"
}
function lc(e) {
    return te(e) ? document.querySelector(e) : e
}
let Ji = !1;
const Th = () => {
    Ji || (Ji = !0,
    gh(),
    $u())
}
  , Rh = Object.freeze(Object.defineProperty({
    __proto__: null,
    BaseTransition: Ko,
    BaseTransitionPropsValidators: Vr,
    Comment: fe,
    DeprecationTypes: Fu,
    EffectScope: Or,
    ErrorCodes: Hf,
    ErrorTypeStrings: wu,
    Fragment: he,
    KeepAlive: ua,
    ReactiveEffect: _n,
    Static: Nt,
    Suspense: ou,
    Teleport: qf,
    Text: pt,
    TrackOpTypes: Pf,
    Transition: Vu,
    TransitionGroup: fh,
    TriggerOpTypes: Mf,
    VueElement: Is,
    assertNumber: Df,
    callWithAsyncErrorHandling: De,
    callWithErrorHandling: Qt,
    camelize: de,
    capitalize: Xt,
    cloneVNode: qe,
    compatUtils: Lu,
    computed: Fs,
    createApp: br,
    createBlock: ls,
    createCommentVNode: mu,
    createElementBlock: hu,
    createElementVNode: zr,
    createHydrationRenderer: pl,
    createPropsRestProxy: La,
    createRenderer: dl,
    createSSRApp: ic,
    createSlots: ya,
    createStaticVNode: gu,
    createTextVNode: Zr,
    createVNode: ce,
    customRef: Oo,
    defineAsyncComponent: fa,
    defineComponent: Ur,
    defineCustomElement: ql,
    defineEmits: Ca,
    defineExpose: Sa,
    defineModel: wa,
    defineOptions: xa,
    defineProps: Ta,
    defineSSRCustomElement: sh,
    defineSlots: Aa,
    devtools: Ou,
    effect: ef,
    effectScope: Nr,
    getCurrentInstance: Ne,
    getCurrentScope: Rr,
    getCurrentWatcher: Lf,
    getTransitionRawChildren: ws,
    guardReactiveProps: Nl,
    h: kl,
    handleError: Lt,
    hasInjectionContext: qr,
    hydrate: vh,
    hydrateOnIdle: sa,
    hydrateOnInteraction: la,
    hydrateOnMediaQuery: oa,
    hydrateOnVisible: ia,
    initCustomFormatter: Su,
    initDirectivesForSSR: Th,
    inject: wt,
    isMemoSame: Dl,
    isProxy: Cs,
    isReactive: Be,
    isReadonly: st,
    isRef: le,
    isRuntimeOnly: vu,
    isShallow: Le,
    isVNode: it,
    markRaw: Ss,
    mergeDefaults: Pa,
    mergeModels: Ma,
    mergeProps: Rl,
    nextTick: Pn,
    normalizeClass: Zt,
    normalizeProps: to,
    normalizeStyle: zt,
    onActivated: Go,
    onBeforeMount: Jo,
    onBeforeUnmount: Rs,
    onBeforeUpdate: jr,
    onDeactivated: qo,
    onErrorCaptured: Qo,
    onMounted: Ln,
    onRenderTracked: Zo,
    onRenderTriggered: zo,
    onScopeDispose: co,
    onServerPrefetch: Xo,
    onUnmounted: Ps,
    onUpdated: Ns,
    onWatcherCleanup: Mo,
    openBlock: xn,
    popScopeId: $f,
    provide: rl,
    proxyRefs: Ir,
    pushScopeId: jf,
    queuePostFlushCb: En,
    reactive: Rn,
    readonly: Fr,
    ref: xt,
    registerRuntimeCompiler: Eu,
    render: rc,
    renderList: _a,
    renderSlot: ba,
    resolveComponent: pa,
    resolveDirective: ma,
    resolveDynamicComponent: ga,
    resolveFilter: Mu,
    resolveTransitionHooks: Wt,
    setBlockTracking: An,
    setDevtoolsHook: Nu,
    setTransitionHooks: rt,
    shallowReactive: xo,
    shallowReadonly: vf,
    shallowRef: Ao,
    ssrContextKey: yl,
    ssrUtils: Pu,
    stop: tf,
    toDisplayString: wr,
    toHandlerKey: Bt,
    toHandlers: Ea,
    toRaw: J,
    toRef: Ro,
    toRefs: No,
    toValue: Sf,
    transformVNodeArgs: du,
    triggerRef: Cf,
    unref: xs,
    useAttrs: Ra,
    useCssModule: oh,
    useCssVars: Ku,
    useHost: Yl,
    useId: Jf,
    useModel: Za,
    useSSRContext: bl,
    useShadowRoot: ih,
    useSlots: Na,
    useTemplateRef: Xf,
    useTransitionState: Hr,
    vModelCheckbox: ei,
    vModelDynamic: Ql,
    vModelRadio: ti,
    vModelSelect: zl,
    vModelText: ds,
    vShow: Wl,
    version: Hl,
    warn: Au,
    watch: Ot,
    watchEffect: Ja,
    watchPostEffect: Xa,
    watchSyncEffect: El,
    withAsyncContext: Fa,
    withCtx: Dr,
    withDefaults: Oa,
    withDirectives: Wf,
    withKeys: Eh,
    withMemo: xu,
    withModifiers: yh,
    withScopeId: Kf
}, Symbol.toStringTag, {
    value: "Module"
}));
/*!
 * pinia v3.0.3
 * (c) 2025 Eduardo San Martin Morote
 * @license MIT
 */
let ni;
const ks = e => ni = e
  , Ph = () => qr() && wt(si) || ni
  , si = Symbol();
function Er(e) {
    return e && typeof e == "object" && Object.prototype.toString.call(e) === "[object Object]" && typeof e.toJSON != "function"
}
var pn;
(function(e) {
    e.direct = "direct",
    e.patchObject = "patch object",
    e.patchFunction = "patch function"
}
)(pn || (pn = {}));
function Mh() {
    const e = Nr(!0)
      , t = e.run( () => xt({}));
    let n = []
      , s = [];
    const r = Ss({
        install(i) {
            ks(r),
            r._a = i,
            i.provide(si, r),
            i.config.globalProperties.$pinia = r,
            s.forEach(o => n.push(o)),
            s = []
        },
        use(i) {
            return this._a ? n.push(i) : s.push(i),
            this
        },
        _p: n,
        _a: null,
        _e: e,
        _s: new Map,
        state: t
    });
    return r
}
const cc = () => {}
;
function Xi(e, t, n, s=cc) {
    e.push(t);
    const r = () => {
        const i = e.indexOf(t);
        i > -1 && (e.splice(i, 1),
        s())
    }
    ;
    return !n && Rr() && co(r),
    r
}
function Dt(e, ...t) {
    e.slice().forEach(n => {
        n(...t)
    }
    )
}
const Ch = e => e()
  , zi = Symbol()
  , Qs = Symbol();
function vr(e, t) {
    e instanceof Map && t instanceof Map ? t.forEach( (n, s) => e.set(s, n)) : e instanceof Set && t instanceof Set && t.forEach(e.add, e);
    for (const n in t) {
        if (!t.hasOwnProperty(n))
            continue;
        const s = t[n]
          , r = e[n];
        Er(r) && Er(s) && e.hasOwnProperty(n) && !le(s) && !Be(s) ? e[n] = vr(r, s) : e[n] = s
    }
    return e
}
const Sh = Symbol();
function xh(e) {
    return !Er(e) || !Object.prototype.hasOwnProperty.call(e, Sh)
}
const {assign: ft} = Object;
function Ah(e) {
    return !!(le(e) && e.effect)
}
function wh(e, t, n, s) {
    const {state: r, actions: i, getters: o} = t
      , l = n.state.value[e];
    let c;
    function u() {
        l || (n.state.value[e] = r ? r() : {});
        const f = No(n.state.value[e]);
        return ft(f, i, Object.keys(o || {}).reduce( (h, m) => (h[m] = Ss(Fs( () => {
            ks(n);
            const y = n._s.get(e);
            return o[m].call(y, y)
        }
        )),
        h), {}))
    }
    return c = fc(e, u, t, n, s, !0),
    c
}
function fc(e, t, n={}, s, r, i) {
    let o;
    const l = ft({
        actions: {}
    }, n)
      , c = {
        deep: !0
    };
    let u, f, h = [], m = [], y;
    const T = s.state.value[e];
    !i && !T && (s.state.value[e] = {}),
    xt({});
    let v;
    function B(P) {
        let E;
        u = f = !1,
        typeof P == "function" ? (P(s.state.value[e]),
        E = {
            type: pn.patchFunction,
            storeId: e,
            events: y
        }) : (vr(s.state.value[e], P),
        E = {
            type: pn.patchObject,
            payload: P,
            storeId: e,
            events: y
        });
        const C = v = Symbol();
        Pn().then( () => {
            v === C && (u = !0)
        }
        ),
        f = !0,
        Dt(h, E, s.state.value[e])
    }
    const D = i ? function() {
        const {state: E} = n
          , C = E ? E() : {};
        this.$patch(U => {
            ft(U, C)
        }
        )
    }
    : cc;
    function A() {
        o.stop(),
        h = [],
        m = [],
        s._s.delete(e)
    }
    const p = (P, E="") => {
        if (zi in P)
            return P[Qs] = E,
            P;
        const C = function() {
            ks(s);
            const U = Array.from(arguments)
              , w = []
              , K = [];
            function z(W) {
                w.push(W)
            }
            function se(W) {
                K.push(W)
            }
            Dt(m, {
                args: U,
                name: C[Qs],
                store: _,
                after: z,
                onError: se
            });
            let H;
            try {
                H = P.apply(this && this.$id === e ? this : _, U)
            } catch (W) {
                throw Dt(K, W),
                W
            }
            return H instanceof Promise ? H.then(W => (Dt(w, W),
            W)).catch(W => (Dt(K, W),
            Promise.reject(W))) : (Dt(w, H),
            H)
        };
        return C[zi] = !0,
        C[Qs] = E,
        C
    }
      , g = {
        _p: s,
        $id: e,
        $onAction: Xi.bind(null, m),
        $patch: B,
        $reset: D,
        $subscribe(P, E={}) {
            const C = Xi(h, P, E.detached, () => U())
              , U = o.run( () => Ot( () => s.state.value[e], w => {
                (E.flush === "sync" ? f : u) && P({
                    storeId: e,
                    type: pn.direct,
                    events: y
                }, w)
            }
            , ft({}, c, E)));
            return C
        },
        $dispose: A
    }
      , _ = Rn(g);
    s._s.set(e, _);
    const F = (s._a && s._a.runWithContext || Ch)( () => s._e.run( () => (o = Nr()).run( () => t({
        action: p
    }))));
    for (const P in F) {
        const E = F[P];
        if (le(E) && !Ah(E) || Be(E))
            i || (T && xh(E) && (le(E) ? E.value = T[P] : vr(E, T[P])),
            s.state.value[e][P] = E);
        else if (typeof E == "function") {
            const C = p(E, P);
            F[P] = C,
            l.actions[P] = E
        }
    }
    return ft(_, F),
    ft(J(_), F),
    Object.defineProperty(_, "$state", {
        get: () => s.state.value[e],
        set: P => {
            B(E => {
                ft(E, P)
            }
            )
        }
    }),
    s._p.forEach(P => {
        ft(_, o.run( () => P({
            store: _,
            app: s._a,
            pinia: s,
            options: l
        })))
    }
    ),
    T && i && n.hydrate && n.hydrate(_.$state, T),
    u = !0,
    f = !0,
    _
}
/*! #__NO_SIDE_EFFECTS__ */
function Lh(e, t, n) {
    let s;
    const r = typeof t == "function";
    s = r ? n : t;
    function i(o, l) {
        const c = qr();
        return o = o || (c ? wt(si, null) : null),
        o && ks(o),
        o = ni,
        o._s.has(e) || (r ? fc(e, t, s, o) : wh(e, s, o)),
        o._s.get(e)
    }
    return i.$id = e,
    i
}
let Oh = "Store";
function Fh(...e) {
    return e.reduce( (t, n) => (t[n.$id + Oh] = function() {
        return n(this.$pinia)
    }
    ,
    t), {})
}
function Ih(e) {
    const t = J(e)
      , n = {};
    for (const s in t) {
        const r = t[s];
        r.effect ? n[s] = Fs({
            get: () => e[s],
            set(i) {
                e[s] = i
            }
        }) : (le(r) || Be(r)) && (n[s] = Ro(e, s))
    }
    return n
}
export {Vu as $, Oe as A, Ac as B, Rh as C, Nh as D, X as E, Ns as F, ls as G, mu as H, xs as I, Ur as J, ce as K, zt as L, wr as M, Me as N, he as O, _a as P, Rn as Q, Ss as R, zr as S, Zt as T, Zr as U, yh as V, An as W, gu as X, Rs as Y, Dr as Z, Ph as _, Ps as a, Wf as a0, Wl as a1, Xf as a2, qf as a3, Ih as a4, Ku as a5, ba as a6, Lh as a7, Pn as a8, wt as a9, Go as aA, ua as aB, Sf as aC, qr as aD, Ne as aE, Nr as aF, Rr as aG, co as aH, Ro as aI, Oo as aJ, vf as aK, Mh as aL, Ra as aM, Ql as aN, zl as aO, ti as aP, rl as aQ, rc as aR, fa as aa, ga as ab, to as ac, Nl as ad, Jo as ae, Na as af, Ja as ag, Eh as ah, le as ai, Fh as aj, ma as ak, ds as al, ei as am, J as an, br as ao, kl as ap, it as aq, qe as ar, ya as as, Ma as at, Za as au, jr as av, pa as aw, xu as ax, Ao as ay, Fr as az, hu as b, Fs as c, xn as d, re as e, Tr as f, ke as g, dc as h, te as i, Xt as j, de as k, ne as l, Rl as m, Bt as n, Ln as o, V as p, Jt as q, xt as r, Tt as s, No as t, Ic as u, kc as v, Ot as w, Dc as x, Hc as y, eo as z};
