const { pool, testConnection } = require('../src/config/database');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const seedDatabase = async () => {
  console.log('🌱 Starting database seeding...\n');
  
  await testConnection();
  
  try {
    // 1. Seed roles
    console.log('📝 Seeding roles...');
    await pool.query(`
      INSERT INTO roles (role_name, description) VALUES
        ('STUDENT', 'Verified university student'),
        ('CAFE_OWNER', 'Owner of cafeteria'),
        ('CAFE_STAFF', 'Employee working in cafeteria'),
        ('DELIVERY_PERSONNEL', 'Responsible for deliveries'),
        ('ADMIN', 'System administrator')
      ON CONFLICT (role_name) DO NOTHING
    `);
    console.log('✅ Roles seeded\n');
    
    // 2. Create admin user
    console.log('👤 Creating admin user...');
    const adminPassword = await bcrypt.hash('Admin123!', 10);
    const adminResult = await pool.query(`
      INSERT INTO users (first_name, last_name, email, phone, password_hash, account_status)
      VALUES ('System', 'Administrator', 'admin@campushub.com', '0912345678', $1, 'ACTIVE')
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `, [adminPassword]);
    
    let adminId = adminResult.rows[0]?.id;
    if (adminId) {
      const adminRole = await pool.query("SELECT id FROM roles WHERE role_name = 'ADMIN'");
      if (adminRole.rows.length > 0) {
        await pool.query(
          'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [adminId, adminRole.rows[0].id]
        );
      }
      console.log('✅ Admin user created (email: admin@campushub.com, password: Admin123!)\n');
    } else {
      console.log('⚠️ Admin user already exists\n');
      // Get existing admin ID
      const existingAdmin = await pool.query("SELECT id FROM users WHERE email = 'admin@campushub.com'");
      adminId = existingAdmin.rows[0]?.id;
    }
    
    // 3. Create sample students
    console.log('👨‍🎓 Creating sample students...');
    const students = [
      { firstName: 'John', lastName: 'Doe', email: 'john.doe@university.edu', phone: '0911111111', studentId: 'STU001', department: 'Computer Science' },
      { firstName: 'Jane', lastName: 'Smith', email: 'jane.smith@university.edu', phone: '0922222222', studentId: 'STU002', department: 'Engineering' },
      { firstName: 'Mike', lastName: 'Johnson', email: 'mike.johnson@university.edu', phone: '0933333333', studentId: 'STU003', department: 'Business' }
    ];
    
    const studentIds = [];
    for (const student of students) {
      const hashedPassword = await bcrypt.hash('Student123!', 10);
      const userResult = await pool.query(`
        INSERT INTO users (first_name, last_name, email, phone, password_hash, account_status)
        VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `, [student.firstName, student.lastName, student.email, student.phone, hashedPassword]);
      
      let userId = userResult.rows[0]?.id;
      if (!userId) {
        // User exists, get existing ID
        const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [student.email]);
        userId = existingUser.rows[0]?.id;
      }
      
      if (userId) {
        studentIds.push(userId);
        
        const studentRole = await pool.query("SELECT id FROM roles WHERE role_name = 'STUDENT'");
        if (studentRole.rows.length > 0) {
          await pool.query(
            'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [userId, studentRole.rows[0].id]
          );
        }
        
        await pool.query(`
          INSERT INTO student_profiles (user_id, student_id, department, year_level, verification_status)
          VALUES ($1, $2, $3, floor(random() * 4 + 1)::int, 'VERIFIED')
          ON CONFLICT (student_id) DO NOTHING
        `, [userId, student.studentId, student.department]);
      }
    }
    console.log('✅ Sample students created\n');
    
    // 4. Seed product categories
    console.log('📦 Seeding product categories...');
    await pool.query(`
      INSERT INTO product_categories (name, description) VALUES
        ('Electronics', 'Laptops, phones, tablets, and accessories'),
        ('Books', 'Textbooks, novels, and study materials'),
        ('Clothing', 'Apparel, shoes, and fashion accessories'),
        ('Furniture', 'Desks, chairs, and dorm furniture'),
        ('Sports', 'Sports equipment and workout gear')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('✅ Product categories seeded\n');
    
    // 5. Get existing users for products
    const users = await pool.query("SELECT id FROM users WHERE email IN ('john.doe@university.edu', 'jane.smith@university.edu', 'mike.johnson@university.edu') LIMIT 3");
    
    // 6. Create sample products
    if (users.rows.length > 0) {
      console.log('🛍️ Creating sample products...');
      const categories = await pool.query('SELECT id FROM product_categories LIMIT 3');
      
      const sampleProducts = [
        { title: 'MacBook Pro 2023', description: '16-inch, 512GB SSD, 16GB RAM', price: 1999.99, condition: 'LIKE_NEW' },
        { title: 'iPhone 14 Pro', description: '128GB, Deep Purple, Like new', price: 899.99, condition: 'LIKE_NEW' },
        { title: 'Calculus Textbook', description: 'Early Transcendentals, 8th Edition', price: 45.00, condition: 'GOOD' },
        { title: 'Desk Lamp', description: 'LED desk lamp with USB port', price: 25.99, condition: 'NEW' },
        { title: 'Gaming Mouse', description: 'RGB wireless gaming mouse', price: 39.99, condition: 'NEW' }
      ];
      
      for (let i = 0; i < sampleProducts.length; i++) {
        const product = sampleProducts[i];
        const sellerId = users.rows[i % users.rows.length].id;
        const categoryId = categories.rows[i % categories.rows.length].id;
        
        await pool.query(`
          INSERT INTO products (seller_id, category_id, title, description, price, condition, stock_quantity, status)
          VALUES ($1, $2, $3, $4, $5, $6, floor(random() * 20 + 1)::int, 'ACTIVE')
          ON CONFLICT DO NOTHING
        `, [sellerId, categoryId, product.title, product.description, product.price, product.condition]);
      }
      console.log('✅ Sample products created\n');
    } else {
      console.log('⚠️ No users found, skipping products\n');
    }
    
    // 7. Seed service categories
    console.log('🛠️ Seeding service categories...');
    await pool.query(`
      INSERT INTO service_categories (name, description) VALUES
        ('Tutoring', 'Academic tutoring and homework help'),
        ('Programming', 'Web development and coding assistance'),
        ('Graphic Design', 'Logo design, posters, and creative work'),
        ('Repair Services', 'Phone, laptop, and device repair')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('✅ Service categories seeded\n');
    
    // 8. Seed menu categories
    console.log('🍽️ Seeding menu categories...');
    await pool.query(`
      INSERT INTO menu_categories (name, description) VALUES
        ('Breakfast', 'Morning meals and coffee'),
        ('Lunch', 'Midday meals and combos'),
        ('Dinner', 'Evening meals'),
        ('Snacks', 'Light bites and appetizers'),
        ('Drinks', 'Beverages, smoothies, and juices')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('✅ Menu categories seeded\n');
    
    console.log('🎉 Database seeding completed successfully!\n');
    console.log('=========================================');
    console.log('📝 Summary:');
    console.log('=========================================');
    console.log('✅ Roles: 5');
    console.log('✅ Admin user: 1');
    console.log('✅ Students: 3');
    console.log('✅ Product categories: 5');
    console.log('✅ Service categories: 4');
    console.log('✅ Menu categories: 5');
    console.log('✅ Products: 5');
    console.log('=========================================\n');
    
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
};

seedDatabase();
