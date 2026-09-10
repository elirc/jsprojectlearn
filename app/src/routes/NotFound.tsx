import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="page">
      <div className="empty">
        <h2>Nothing here.</h2>
        <p className="muted">
          That route does not exist. <Link to="/">Back to today</Link>.
        </p>
      </div>
    </div>
  );
}
