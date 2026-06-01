// src/utils/dbHelper.js
const { query } = require('../config/database');

class DBHelper {
  static async findOne(table, conditions) {
    const keys = Object.keys(conditions);
    const values = Object.values(conditions);
    const whereClause = keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ');
    
    const sql = `SELECT * FROM ${table} WHERE ${whereClause} AND deleted_at IS NULL LIMIT 1`;
    const result = await query(sql, values);
    return result.rows[0];
  }
  
  static async findAll(table, conditions = {}, limit = 50, offset = 0) {
    const keys = Object.keys(conditions);
    const values = Object.values(conditions);
    let whereClause = '';
    
    if (keys.length > 0) {
      whereClause = `WHERE ${keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ')} AND deleted_at IS NULL`;
    } else {
      whereClause = 'WHERE deleted_at IS NULL';
    }
    
    const sql = `SELECT * FROM ${table} ${whereClause} LIMIT $${keys.length + 1} OFFSET $${keys.length + 2}`;
    const result = await query(sql, [...values, limit, offset]);
    return result.rows;
  }
  
  static async create(table, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const columns = keys.join(', ');
    
    const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`;
    const result = await query(sql, values);
    return result.rows[0];
  }
  
  static async update(table, id, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
    
    const sql = `UPDATE ${table} SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${keys.length + 1} RETURNING *`;
    const result = await query(sql, [...values, id]);
    return result.rows[0];
  }
  
  static async delete(table, id) {
    const sql = `UPDATE ${table} SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id`;
    const result = await query(sql, [id]);
    return result.rows[0];
  }
}

module.exports = DBHelper;