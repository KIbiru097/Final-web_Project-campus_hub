const { query } = require('../../config/database');

const cafeResolvers = {
  Query: {
    cafes: async () => {
      const result = await query('SELECT * FROM cafes WHERE deleted_at IS NULL');
      return result.rows.map(cafe => ({
        id: cafe.id,
        name: cafe.name,
        description: cafe.description,
        location: cafe.location,
        status: cafe.status,
        logoUrl: cafe.logo_url,
        createdAt: cafe.created_at
      }));
    },
    cafe: async (_, { id }) => {
      const result = await query('SELECT * FROM cafes WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (result.rows.length === 0) return null;
      const cafe = result.rows[0];
      return {
        id: cafe.id,
        name: cafe.name,
        description: cafe.description,
        location: cafe.location,
        status: cafe.status,
        logoUrl: cafe.logo_url,
        createdAt: cafe.created_at
      };
    }
  }
};

module.exports = cafeResolvers;