import { Router, Request, Response } from 'express';
// @ts-ignore - country-state-city types may not be available
import { Country, State, City } from 'country-state-city';

const router = Router();

// GET /api/location/countries
router.get('/countries', (req: Request, res: Response) => {
  try {
    const countries = Country.getAllCountries().map((c: any) => ({
      value: c.isoCode,
      label: c.name,
      phonecode: c.phonecode,
    }));
    res.json(countries);
  } catch (error) {
    console.error('Error fetching countries:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch countries' });
  }
});

// GET /api/location/states?countryCode=...
router.get('/states', (req: Request, res: Response) => {
  try {
    const countryCode = req.query.countryCode || req.query.country_code;
    if (!countryCode || typeof countryCode !== 'string') {
      res.status(400).json({ success: false, error: 'countryCode query parameter is required' });
      return;
    }
    const states = State.getStatesOfCountry(countryCode.toUpperCase()).map((s: any) => ({
      value: s.isoCode,
      label: s.name,
    }));
    res.json(states);
  } catch (error) {
    console.error('Error fetching states:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch states' });
  }
});

// GET /api/location/cities?countryCode=...&stateCode=...
router.get('/cities', (req: Request, res: Response) => {
  try {
    const countryCode = req.query.countryCode || req.query.country_code;
    const stateCode = req.query.stateCode || req.query.state_code;
    if (!countryCode || typeof countryCode !== 'string') {
      res.status(400).json({ success: false, error: 'countryCode query parameter is required' });
      return;
    }
    
    let cities;
    if (stateCode && typeof stateCode === 'string') {
      cities = (City.getCitiesOfState(countryCode.toUpperCase(), stateCode) || []).map((c: any) => ({
        value: c.name,
        label: c.name,
      }));
    } else {
      cities = (City.getCitiesOfCountry(countryCode.toUpperCase()) || []).map((c: any) => ({
        value: c.name,
        label: c.name,
      }));
    }
    res.json(cities);
  } catch (error) {
    console.error('Error fetching cities:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch cities' });
  }
});

export default router;
