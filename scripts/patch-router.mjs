import {readFileSync,writeFileSync} from 'node:fs';
const dir=new URL('../.cache/find-my-way/lib/',import.meta.url);
const read=name=>readFileSync(new URL(name,dir),'utf8').replaceAll('\r','');
const write=(name,text)=>writeFileSync(new URL(name,dir),text);
let source=read('handler-storage.js');
let start=source.indexOf('  _compileCreateParamsObject (params) {'),end=source.indexOf('  _getHandlerMatchingConstraints ()',start);
if(start<0||end<0)throw new Error('Unexpected pinned router source');
source=source.slice(0,start)+`  _compileCreateParamsObject (params) {
    const names = params.slice()
    return function _createParamsObject (paramsArray) {
      const result = new NullObject()
      for (let i = 0; i < names.length; i++) result[names[i]] = paramsArray[i]
      return result
    }
  }

`+source.slice(end);
start=source.indexOf('  _compileGetHandlerMatchingConstraints (constrainer) {');end=source.lastIndexOf('\n  }\n}');
if(start<0||end<start)throw new Error('Unexpected constraint compiler');
source=source.slice(0,start)+`  _compileGetHandlerMatchingConstraints (constrainer) {
    this.constrainedHandlerStores = {}
    for (const constraint of this.constraints) {
      const store = constrainer.newStoreForConstraint(constraint)
      this.constrainedHandlerStores[constraint] = store
      this._buildConstraintStore(store, constraint)
    }
    this._getHandlerMatchingConstraints = function (derivedConstraints) {
      let candidates = (1 << this.handlers.length) - 1
      for (const constraint of this.constraints) {
        const mask = this._constrainedIndexBitmask(constraint)
        const value = derivedConstraints[constraint]
        if (value === undefined) candidates &= mask
        else {
          const matches = this.constrainedHandlerStores[constraint].get(value) || 0
          candidates &= constrainer.strategies[constraint].mustMatchWhenDerived ? matches : (matches | mask)
        }
        if (candidates === 0) return null
      }
      for (const constraint in constrainer.strategies) {
        if (!Object.hasOwn(constrainer.strategies, constraint)) continue
        if (constrainer.strategies[constraint].mustMatchWhenDerived && !this.constraints.includes(constraint) && derivedConstraints[constraint] !== undefined) return null
      }
      return this.handlers[31 - Math.clz32(candidates)] || null
    }
  }`+source.slice(end+4);
if(source.includes('new Function'))throw new Error('Dynamic handler compilation remains');
write('handler-storage.js',source);
source=read('node.js');start=source.indexOf('  _compilePrefixMatch () {');end=source.indexOf('\n}\n',start);
source=source.slice(0,start)+`  _compilePrefixMatch () {
    const suffix = this.prefix.slice(1)
    this.matchPrefix = (path, i) => path.startsWith(suffix, i + 1)
  }`+source.slice(end);
if(source.includes('new Function'))throw new Error('Dynamic prefix compilation remains');write('node.js',source);
source=read('constrainer.js');start=source.indexOf('  _buildDeriveConstraints () {');end=source.lastIndexOf('\n  }\n}');
source=source.slice(0,start)+`  _buildDeriveConstraints () {
    if (this.strategiesInUse.size === 0) return
    this.deriveSyncConstraints = (req, ctx) => {
      const derived = {}
      for (const key of this.strategiesInUse) {
        const strategy = this.strategies[key]
        derived[key] = strategy.isCustom ? strategy.deriveConstraint(req, ctx) : key === 'version' ? req.headers['accept-version'] : req.headers.host || req.headers[':authority']
      }
      return derived
    }
  }`+source.slice(end+4);
if(source.includes('new Function'))throw new Error('Dynamic constraint compilation remains');write('constrainer.js',source);
console.log('Pinned router now uses ordinary closures for params, prefixes and constraints.');
