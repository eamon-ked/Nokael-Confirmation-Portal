import { useEffect, useState } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Job } from '../types';
import { Loader2, MapPin, Navigation } from 'lucide-react';

const API_KEY = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

interface DriverMapProps {
  job: Job;
}

function RoutePolyline({ origin, destination }: { origin: google.maps.LatLngLiteral; destination: google.maps.LatLngLiteral }) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const [polyline, setPolyline] = useState<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!routesLib || !map || !origin || !destination) return;

    if (polyline) polyline.setMap(null);

    routesLib.Route.computeRoutes({
      origin: origin,
      destination: destination,
      travelMode: 'DRIVING',
      fields: ['path', 'viewport'],
    }).then(({ routes }) => {
      if (routes?.[0]) {
        const polylines = routes[0].createPolylines();
        polylines.forEach(p => p.setMap(map));
        setPolyline(polylines[0]);
        if (routes[0].viewport) {
           map.fitBounds(routes[0].viewport, { padding: 50 });
        }
      }
    }).catch(err => console.error('Route error:', err));

    return () => {
      if (polyline) polyline.setMap(null);
    };
  }, [routesLib, map, origin.lat, origin.lng, destination.lat, destination.lng]);

  return null;
}

export default function DriverMap({ job }: DriverMapProps) {
  if (!hasValidKey) {
    return (
      <div className="nokael-card !p-8 bg-slate-50 border-slate-200 text-center space-y-4">
        <MapPin className="w-8 h-8 text-slate-300 mx-auto" />
        <div className="space-y-1">
          <p className="text-sm font-black uppercase text-nokael-primary italic">Map Unavailable</p>
          <p className="text-[10px] text-nokael-text-muted font-medium">To enable live tracking, please provide a Google Maps API Key in Secrets.</p>
        </div>
      </div>
    );
  }

  const pickup = job.pickup_lat && job.pickup_lng ? { lat: job.pickup_lat, lng: job.pickup_lng } : null;
  const delivery = job.delivery_lat && job.delivery_lng ? { lat: job.delivery_lat, lng: job.delivery_lng } : null;
  const driver = job.driver_lat && job.driver_lng ? { lat: job.driver_lat, lng: job.driver_lng } : null;

  const center = driver || pickup || { lat: 25.2048, lng: 55.2708 }; // Default to Dubai

  return (
    <div className="nokael-card !p-0 overflow-hidden border-nokael-border shadow-md">
      <div className="h-[280px] w-full relative">
        <APIProvider apiKey={API_KEY} version="weekly">
          <Map
            defaultCenter={center}
            defaultZoom={12}
            mapId="NOKAEL_LIVE_TRACKING"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            style={{ width: '100%', height: '100%' }}
            disableDefaultUI={true}
            zoomControl={true}
          >
            {pickup && (
              <AdvancedMarker position={pickup} title="Pickup Location">
                <div className="bg-white p-1 rounded-full shadow-lg border-2 border-nokael-primary">
                  <MapPin className="w-5 h-5 text-nokael-primary" />
                </div>
              </AdvancedMarker>
            )}

            {delivery && (
              <AdvancedMarker position={delivery} title="Delivery Location">
                <div className="bg-white p-1 rounded-full shadow-lg border-2 border-red-500">
                  <MapPin className="w-5 h-5 text-red-500" />
                </div>
              </AdvancedMarker>
            )}

            {driver && (
              <AdvancedMarker position={driver} title="Driver Location">
                <div className="bg-nokael-primary p-2 rounded-full shadow-xl animate-pulse">
                  <Navigation className="w-5 h-5 text-white fill-white" />
                </div>
              </AdvancedMarker>
            )}

            {pickup && delivery && <RoutePolyline origin={pickup} destination={delivery} />}
          </Map>
        </APIProvider>

        {/* Live Indicator Overlay */}
        <div className="absolute top-4 left-4 flex items-center gap-2 bg-white/90 backdrop-blur px-3 py-1.5 rounded-full border border-nokael-border shadow-sm">
          <div className="w-2 h-2 bg-nokael-accent rounded-full animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-[0.1em] text-nokael-primary">Live Driver Location</span>
        </div>
      </div>
      
      <div className="p-4 bg-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center border border-nokael-border">
            <Navigation className="w-5 h-5 text-nokael-primary" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-nokael-primary tracking-widest leading-none">Status</p>
            <p className="text-xs font-bold text-nokael-text-main mt-1">
              {driver ? 'Real-time GPS Tracking Active' : 'Waiting for Driver Connection...'}
            </p>
          </div>
        </div>
        {!driver && (
          <Loader2 className="w-4 h-4 text-nokael-accent animate-spin" />
        )}
      </div>
    </div>
  );
}
