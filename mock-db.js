const fs = require("fs");
const path = require("path");

class MockCollection {
  constructor(name) {
    this.name = name;
    this.filePath = path.join(__dirname, "tmp", `db_${name}.json`);
    // Ensure tmp folder exists
    if (!fs.existsSync(path.dirname(this.filePath))) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }
  }

  _read() {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return [];
    }
  }

  _write(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  async findOne(query) {
    const data = this._read();
    return data.find(item => this._matches(item, query)) || null;
  }

  find(query) {
    const data = this._read();
    const filtered = data.filter(item => this._matches(item, query));
    
    return {
      toArray: async () => filtered,
      sort: (sortSpec) => {
        return {
          limit: (n) => {
            return {
              toArray: async () => filtered.slice(0, n)
            };
          },
          toArray: async () => filtered
        };
      },
      limit: (n) => {
        return {
          toArray: async () => filtered.slice(0, n)
        };
      }
    };
  }

  async insertOne(doc) {
    const data = this._read();
    const newDoc = { ...doc };
    if (newDoc._id === undefined && newDoc.id === undefined) {
      newDoc._id = Math.random().toString(36).substring(2, 9);
    }
    data.push(newDoc);
    this._write(data);
    return { insertedId: newDoc._id || newDoc.id };
  }

  async insertMany(docs) {
    const data = this._read();
    const insertedIds = [];
    for (const doc of docs) {
      const newDoc = { ...doc };
      if (newDoc._id === undefined && newDoc.id === undefined) {
        newDoc._id = Math.random().toString(36).substring(2, 9);
      }
      data.push(newDoc);
      insertedIds.push(newDoc._id || newDoc.id);
    }
    this._write(data);
    return { insertedIds };
  }

  async updateOne(query, update, options = {}) {
    const data = this._read();
    let index = data.findIndex(item => this._matches(item, query));
    let upsertedCount = 0;
    let modifiedCount = 0;

    if (index === -1) {
      if (options.upsert) {
        let newDoc = { ...query };
        if (update.$setOnInsert) {
          Object.assign(newDoc, update.$setOnInsert);
        }
        if (update.$set) {
          Object.assign(newDoc, update.$set);
        }
        data.push(newDoc);
        this._write(data);
        upsertedCount = 1;
      }
    } else {
      const item = data[index];
      if (update.$set) {
        Object.assign(item, update.$set);
        modifiedCount = 1;
      }
      if (update.$inc) {
        for (const key in update.$inc) {
          item[key] = (item[key] || 0) + update.$inc[key];
        }
        modifiedCount = 1;
      }
      if (update.$max) {
        for (const key in update.$max) {
          item[key] = Math.max(item[key] || 0, update.$max[key]);
        }
        modifiedCount = 1;
      }
      data[index] = item;
      this._write(data);
    }

    return { modifiedCount, upsertedCount };
  }

  async updateMany(query, update, options = {}) {
    const data = this._read();
    let matched = data.filter(item => this._matches(item, query));
    let modifiedCount = 0;

    for (let item of matched) {
      if (update.$set) {
        Object.assign(item, update.$set);
        modifiedCount++;
      }
    }
    this._write(data);
    return { modifiedCount };
  }

  async deleteOne(query) {
    const data = this._read();
    const index = data.findIndex(item => this._matches(item, query));
    let deletedCount = 0;
    if (index !== -1) {
      data.splice(index, 1);
      this._write(data);
      deletedCount = 1;
    }
    return { deletedCount };
  }

  async deleteMany(query) {
    const data = this._read();
    const initialLength = data.length;
    const filtered = data.filter(item => !this._matches(item, query));
    this._write(filtered);
    return { deletedCount: initialLength - filtered.length };
  }

  async findOneAndUpdate(query, update, options = {}) {
    const data = this._read();
    let item = data.find(item => this._matches(item, query));
    if (!item && options.upsert) {
      item = { ...query };
      data.push(item);
    }
    if (item) {
      if (update.$inc) {
        for (const key in update.$inc) {
          item[key] = (item[key] || 0) + update.$inc[key];
        }
      }
      if (update.$set) {
        Object.assign(item, update.$set);
      }
      this._write(data);
    }
    return item;
  }

  async countDocuments(query) {
    const data = this._read();
    return data.filter(item => this._matches(item, query)).length;
  }

  async createIndex() {
    return true;
  }

  _matches(item, query) {
    if (!query || Object.keys(query).length === 0) return true;
    for (const key in query) {
      if (key === "$or") {
        if (!Array.isArray(query[key]) || !query[key].some(part => this._matches(item, part))) return false;
        continue;
      }
      if (key === "$and") {
        if (!Array.isArray(query[key]) || !query[key].every(part => this._matches(item, part))) return false;
        continue;
      }
      const queryVal = query[key];
      
      if (queryVal && typeof queryVal === "object" && "$in" in queryVal) {
        if (!Array.isArray(queryVal.$in)) return false;
        const itemVal = String(item[key]);
        const inMatch = queryVal.$in.some(v => String(v) === itemVal);
        if (!inMatch) return false;
        continue;
      }
      if (queryVal && typeof queryVal === "object" && "$ne" in queryVal) {
        if (String(item[key]) === String(queryVal.$ne)) return false;
        continue;
      }
      if (queryVal && typeof queryVal === "object" && "$exists" in queryVal) {
        const exists = item[key] !== undefined;
        if (exists !== Boolean(queryVal.$exists)) return false;
        continue;
      }
      if (queryVal && typeof queryVal === "object" && "$lte" in queryVal) {
        if (item[key] > queryVal.$lte) return false;
        continue;
      }
      if (queryVal && typeof queryVal === "object" && "$lt" in queryVal) {
        if (item[key] >= queryVal.$lt) return false;
        continue;
      }
      if (queryVal && typeof queryVal === "object" && "$regex" in queryVal) {
        const regex = queryVal.$regex instanceof RegExp ? queryVal.$regex : new RegExp(queryVal.$regex, "i");
        if (!regex.test(String(item[key] || ""))) return false;
        continue;
      }

      if (String(item[key]) !== String(queryVal)) {
        return false;
      }
    }
    return true;
  }
}

module.exports = { MockCollection };
