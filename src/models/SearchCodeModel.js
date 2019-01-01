import BaseModel from './BaseModel';
import * as Tools from '../utils/Tools';
import YoudaoTranslateData from './metadata/YoudaoTranslateData';
import JSONP from '../utils/JSONP';
import Store from './Store';
import AppModel from './AppModel';
import md5 from 'md5';

class SearchCodeModel extends BaseModel {
  constructor() {
    super();
    this._data = {
      isZH: false,
      searchValue: null,
      searchLang: [],
      page: 0,
      variableList: [],
      suggestion: [],
      sourceCode: null
    };
    this._variableRepoMapping = {};
    this._sourceCodeStore = new Store(Infinity, {
      persistence: 'session',
      persistenceKey: AppModel.genPersistenceKey('source_code_key')
    });
    this._variableListStore = new Store(Infinity, {
      persistence: 'session',
      persistenceKey: AppModel.genPersistenceKey('variable_list_key')
    });
  }

  //search code by query
  async requestVariable(val, page, lang) {
    if (val !== undefined && val !== null) {
      val = val.trim().replace(/\s+/ig, ' '); // filter spaces
    }
    if (val.length < 1) {
      return;
    }
    let q = val;
    let suggestion = this._parseSuggestion(val.split(' '));
    let isZH = this._isZH(val);
    if (isZH) {
      // translate by youdao
      const translate = await YoudaoTranslateData.request(val);
      if (translate) {
        q = translate.translation;
        suggestion = this._parseSuggestion(translate.suggestion, suggestion);
        suggestion = this._parseSuggestion(q.split(' '), suggestion);
      } else {
        this.update({
          searchValue: val,
          page: page,
          variableList: [...this.variableList, []],
          searchLang: lang,
          suggestion: suggestion,
          isZH: isZH || this.isZH
        });
      }
    }
    const cacheId = md5(q + page + (lang ? lang.sort().join(',') : ''));
    const cache = this._variableListStore.get(cacheId);
    if (cache) {
      this.update(cache);
      return;
    }
    // multiple val separate with '+'
    // const url = `//searchcode.com/api/codesearch_I/?q=${q.replace(' ', '+')}&p=${page}&per_page=42${lang.length ? ('&lan=' + lang.join(',')) : ''}`;
    const url = `//searchcode.com/api/jsonp_codesearch_I/?callback=?&q=${q.replace(' ', '+')}&p=${page}&per_page=42${lang.length ? ('&lan=' + lang.join(',')) : ''}`;
    val && JSONP(url)
      .then(data => {
        const cdata = {
          searchValue: val,
          page: page,
          variableList: [...this._data.variableList, this._parseVariableList(data.results, q)],
          searchLang: lang,
          suggestion: suggestion,
          isZH: isZH || this.isZH
        };
        this.update(cdata);
        this._variableListStore.save(cacheId, cdata);
      }).catch(err => {
        this.update({
          searchValue: val,
          page: page,
          variableList: [...this.variableList, []],
          searchLang: lang,
          suggestion: suggestion,
          isZH: isZH || this.isZH
        });
      });
  }

  //get source code by id
  requestSourceCode(id) {
    const cache = this._sourceCodeStore.get(id);
    if (cache) {
      this.update({sourceCode: cache});
      return;
    }
    id && fetch('https://searchcode.com/api/result/' + id + '/')
      .then(res => res.json())
      .then(data => {
        this._sourceCodeStore.save(id, data.code);
        this.update({sourceCode: data.code});
      });
  }

  getKeyWordReg(keyword) {
    return new RegExp('([\\-_\\w\\d\\/\\$]{0,}){0,1}' + keyword + '([\\-_\\w\\d\\$]{0,}){0,1}', 'gi');
  }

  getKeyWroddRegs(keywords) {
    return keywords.split(' ').reduce((accumulator, curr) => {
      if (curr.length && curr.length > 1) {
        return accumulator.concat(this.getKeyWordReg(curr));
      }
    }, []);
  }

  _parseVariableList(results, keywords) {
    let vals = [], variables = [];
    results.forEach(res => {
      res.repo = res.repo.replace('git://github.com', 'https://github.com');
      //filter codes
      const lineStr = Object.keys(res.lines).reduce((accu, line) => {
        let lstr = res.lines[line];
        //no base64
        if (!(/;base64,/g.test(lstr) && lstr.length > 256)) {
          return accu.concat(lstr);
        }
      }, []).join('').replace(/\r\n/g, ' '); // remove \r\n
      //match variables
      this.getKeyWroddRegs(keywords).forEach(reg => {
        (lineStr.match(reg) || []).forEach(val => {
          //remove "-" and "/" from the start and the end
          val = val.replace(/^(\-|\/)*/, '').replace(/(\-|\/)*$/, '');
          this._updateVariableRepoMapping(val, res);
          if (
            !/\//g.test(val) /*exclude links*/
            && vals.indexOf(val) === -1
            && vals.indexOf(val.toLowerCase()) === -1
            && vals.indexOf(val.toUpperCase()) === -1
            && val.length < 64 /*too long*/
          ) {
            vals.push(val);
            variables.push({
              keyword: val,
              repoLink: res.repo,
              repoLang: res.language,
              color: Tools.randomLabelColor()
            });
          }
        });
      });
    });
    return variables.map(val => {
      val.repoList = this._getVariableRepoMapping(val.keyword);
      return val;
    });
  }

  _parseSuggestion(keywords, curr) {
    let suggestion = curr || this.suggestion;
    if (keywords) {
      suggestion = keywords.concat(suggestion);
    }
    return [...new Set(suggestion)].filter((item, i) => !this._isZH(item));
  }

  _updateVariableRepoMapping(val, repo) {
    if (!/\//g.test(val) /*exclude links*/ && val.length < 64 /*too long*/) {
      val = `__${val.toLowerCase()}`;
      this._variableRepoMapping[val] = this._variableRepoMapping[val] || [];
      if (!this._variableRepoMapping[val].find(key => key.id == repo.id)) {
        this._variableRepoMapping[val].push(repo);
      }
    }
  }

  _getVariableRepoMapping(val) {
    val = `__${val.toLowerCase()}`;
    return this._variableRepoMapping[val];
  }

  _isZH(val) {
    let isZH = false;
    val.replace(/\s+/ig, '+').split('+').forEach((key) => {
      if (/[^\x00-\xff]/gi.test(key)) {
        isZH = true;
      }
    });
    return isZH;
  }

  get searchValue() {
    return this._data.searchValue;
  }

  get searchLang() {
    return this._data.searchLang;
  }

  get page() {
    return this._data.page;
  }

  get variableList() {
    return this._data.variableList;
  }

  get suggestion() {
    return this._data.suggestion;
  }

  get isZH() {
    return this._data.isZH;
  }

  get sourceCode() {
    return this._data.sourceCode;
  }
}

export default new SearchCodeModel();
