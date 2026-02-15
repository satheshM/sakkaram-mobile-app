const axios = require('axios');

const API_URL = 'http://localhost:5000/api';

console.log('🔧 Setting up test data...\n');

const setup = async () => {
  try {
    // 1. Create Owner Account
    console.log('Step 1: Create Owner Account');
    let res = await axios.post(`${API_URL}/auth/send-otp`, { phoneNumber: '9876543211' });
    res = await axios.post(`${API_URL}/auth/verify-otp`, {
      phoneNumber: '9876543211',
      otp: res.data.dev_otp,
      fullName: 'Ramesh Kumar',
      role: 'owner'
    });
    const ownerToken = res.data.tokens.accessToken;
    console.log('✅ Owner created:', res.data.user.fullName, '\n');

    // 2. Create Farmer Account
    console.log('Step 2: Create Farmer Account');
    res = await axios.post(`${API_URL}/auth/send-otp`, { phoneNumber: '9876543212' });
    res = await axios.post(`${API_URL}/auth/verify-otp`, {
      phoneNumber: '9876543212',
      otp: res.data.dev_otp,
      fullName: 'Suresh Farmer',
      role: 'farmer'
    });
    console.log('✅ Farmer created:', res.data.user.fullName, '\n');

    // 3. Add Vehicle (as Owner)
    console.log('Step 3: Add Vehicle');
    res = await axios.post(
      `${API_URL}/vehicles`,
      {
        name: 'Mahindra Tractor 575 DI',
        type: 'Tractor',
        model: '575 DI',
        registrationNumber: 'TN37AB1234',
        specifications: {
          horsepower: '45 HP',
          engine: '4 Cylinder',
          features: ['4WD', 'Power Steering']
        },
        capacity: '2 Ton',
        locationAddress: 'Gandhipuram, Coimbatore, Tamil Nadu',
        locationLat: 11.0168,
        locationLng: 76.9558,
        serviceRadiusKm: 50,
        servicesOffered: [
          {
            serviceName: 'Plowing',
            pricingType: 'hourly',
            hourlyRate: 500,
            perAcreRate: null,
            fixedPrice: null
          },
          {
            serviceName: 'Tilling',
            pricingType: 'per_acre',
            hourlyRate: null,
            perAcreRate: 800,
            fixedPrice: null
          }
        ],
        availabilitySchedule: {
          monday: { available: true, hours: '6AM-6PM' },
          tuesday: { available: true, hours: '6AM-6PM' },
          wednesday: { available: true, hours: '6AM-6PM' },
          thursday: { available: true, hours: '6AM-6PM' },
          friday: { available: true, hours: '6AM-6PM' },
          saturday: { available: true, hours: '6AM-6PM' },
          sunday: { available: false }
        }
      },
      { headers: { Authorization: `Bearer ${ownerToken}` } }
    );
    console.log('✅ Vehicle added:', res.data.vehicle.name, '\n');

    // 4. Top-up Owner Wallet
    console.log('Step 4: Top-up Owner Wallet');
    res = await axios.post(
      `${API_URL}/wallet/add-money`,
      {
        amount: 500,
        paymentMethod: 'UPI',
        transactionId: 'SETUP123'
      },
      { headers: { Authorization: `Bearer ${ownerToken}` } }
    );
    console.log('✅ Wallet topped up: ₹500\n');

    console.log('🎉 TEST DATA SETUP COMPLETE!\n');
    console.log('Summary:');
    console.log('✅ Owner: 9876543211 (Ramesh Kumar)');
    console.log('✅ Farmer: 9876543212 (Suresh Farmer)');
    console.log('✅ Vehicle: Mahindra Tractor');
    console.log('✅ Wallet: ₹500');
    console.log('\nNow run: node testBookingAPIs.js\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.response?.data || error.message);
    process.exit(1);
  }
};

setup();